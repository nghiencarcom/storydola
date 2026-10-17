import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import proxy_manager


class _Response:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, _limit):
        return json.dumps(self.payload).encode("utf-8")


class ProxyFBTests(unittest.TestCase):
    def setUp(self):
        self._activation_wait_patch = patch.object(
            proxy_manager, "PROXYFB_IP_ACTIVATION_WAIT_SEC", 0
        )
        self._activation_wait_patch.start()
        self._exit_ip_patch = patch.object(
            proxy_manager.ProxyManager,
            "_check_proxyfb_exit_ip",
            side_effect=lambda row: str(row["host"]),
        )
        self._exit_ip_patch.start()
        self.addCleanup(self._exit_ip_patch.stop)
        self.addCleanup(self._activation_wait_patch.stop)

    def test_documented_payload_and_current_error_payload(self):
        payload = proxy_manager._proxyfb_result(
            {
                "success": True,
                "proxy": "198.51.100.10:18080",
                "location": 1,
                "next_change": "120",
                "timeout": "641",
            },
            action="changeProxy",
        )
        self.assertEqual((payload["host"], payload["port"], payload["location_id"]), ("198.51.100.10", 18080, "1"))
        with self.assertRaisesRegex(proxy_manager.ProxyFBError, "Key không chính xác"):
            proxy_manager._proxyfb_result(
                {"statusCode": 404, "message": "Key không chính xác"},
                action="getProxy",
            )

    def test_key_is_encrypted_and_lease_is_reused(self):
        calls = []

        def fake_urlopen(url, timeout):
            calls.append((url, timeout))
            return _Response(
                {
                    "success": True,
                    "proxy": "198.51.100.20:18080",
                    "location": 1,
                    "next_change": "120",
                    "timeout": "641",
                }
            )

        with tempfile.TemporaryDirectory() as directory:
            db_path = Path(directory) / "pool.db"
            manager = proxy_manager.ProxyManager(db_path)
            manager._conn.execute(
                "INSERT INTO accounts_meta(name,created_at) VALUES(?,?)",
                ("profile-a", 0),
            )
            manager._conn.commit()
            with patch.object(proxy_manager, "urlopen", side_effect=fake_urlopen):
                action, proxy = manager.create_proxyfb(
                    name="ProxyFB JP",
                    api_key="secret-key-123",
                    location_id="1",
                )
                manager.assign("profile-a", proxy["id"])
                first = manager.proxy_for_account("profile-a")
                second = manager.proxy_for_account("profile-a")

            self.assertEqual(action, "created")
            self.assertEqual(first["server"], second["server"])
            self.assertEqual(len(calls), 1)
            self.assertNotIn(b"secret-key-123", db_path.read_bytes())
            self.assertTrue(manager.list_public()[0]["proxyfb_configured"])

    def test_successful_just_in_time_check_clears_stale_error(self):
        def fake_urlopen(_url, timeout):
            self.assertGreater(timeout, 0)
            return _Response({
                "success": True,
                "proxy": "198.51.100.25:18080",
                "location": 1,
                "next_change": "120",
                "timeout": "641",
            })

        with tempfile.TemporaryDirectory() as directory:
            manager = proxy_manager.ProxyManager(Path(directory) / "pool.db")
            manager._conn.execute(
                "INSERT INTO accounts_meta(name,created_at) VALUES(?,?)",
                ("profile-a", 0),
            )
            manager._conn.commit()
            with patch.object(proxy_manager, "urlopen", side_effect=fake_urlopen):
                _, proxy = manager.create_proxyfb(
                    name="ProxyFB stale status",
                    api_key="stale-status-key",
                    location_id="1",
                )
            manager.assign("profile-a", proxy["id"])
            manager._conn.execute(
                "UPDATE proxy_profiles SET status='error', last_checked_at=0 WHERE id=?",
                (proxy["id"],),
            )
            manager._conn.commit()
            with patch.object(
                manager, "_check_proxyfb_exit_ip", side_effect=lambda row: str(row["host"])
            ):
                current = manager.proxy_for_account("profile-a")

            self.assertEqual(current["server"], "http://198.51.100.25:18080")
            self.assertEqual(manager.list_public()[0]["status"], "healthy")

    def test_failed_proxy_health_check_honors_retry_backoff(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = proxy_manager.ProxyManager(Path(directory) / "pool.db")
            manager._conn.execute(
                "INSERT INTO accounts_meta(name,created_at) VALUES(?,?)",
                ("profile-a", 0),
            )
            manager._conn.commit()
            with patch.object(
                proxy_manager,
                "urlopen",
                return_value=_Response({
                    "success": True,
                    "proxy": "198.51.100.26:18080",
                    "location": 1,
                    "next_change": "120",
                    "timeout": "641",
                }),
            ):
                _, proxy = manager.create_proxyfb(
                    name="ProxyFB backoff",
                    api_key="backoff-key",
                    location_id="1",
                )
            manager.assign("profile-a", proxy["id"])
            now = proxy_manager.time.time()
            manager._conn.execute(
                "UPDATE proxy_profiles SET status='error', last_error=?, "
                "proxy_retry_at=? WHERE id=?",
                ("checker timeout", now + 300, proxy["id"]),
            )
            manager._conn.commit()

            with patch.object(
                manager,
                "_check_proxyfb_exit_ip",
                side_effect=AssertionError("must honor cached retry backoff"),
            ):
                with self.assertRaisesRegex(proxy_manager.ProxyFBError, "backoff"):
                    manager.proxy_for_account("profile-a")

    def test_proxyfb_rotates_at_provider_timeout_when_next_change_is_ready(self):
        calls = []

        def fake_urlopen(url, timeout):
            calls.append((url, timeout))
            endpoint = "198.51.100.40:18080" if len(calls) == 1 else "198.51.100.41:18080"
            return _Response(
                {
                    "success": True,
                    "proxy": endpoint,
                    "location": 1,
                    "next_change": "120",
                    "timeout": "641",
                }
            )

        with tempfile.TemporaryDirectory() as directory:
            manager = proxy_manager.ProxyManager(Path(directory) / "pool.db")
            manager._conn.execute(
                "INSERT INTO accounts_meta(name,created_at) VALUES(?,?)",
                ("profile-a", 0),
            )
            manager._conn.commit()
            with patch.object(proxy_manager, "urlopen", side_effect=fake_urlopen):
                _, proxy = manager.create_proxyfb(
                    name="ProxyFB rotating",
                    api_key="rotation-secret-key",
                    location_id="1",
                )
                manager.assign("profile-a", proxy["id"])
                now = proxy_manager.time.time()
                manager._conn.execute(
                    "UPDATE proxy_profiles SET proxy_last_rotated_at=?, "
                    "proxy_next_change_at=?, proxy_timeout_at=? WHERE id=?",
                    (
                        now,
                        now - 1,
                        now + proxy_manager.PROXYFB_REFRESH_MARGIN_SEC - 1,
                        proxy["id"],
                    ),
                )
                manager._conn.commit()
                refreshed = manager.proxy_for_account("profile-a")

            self.assertEqual(len(calls), 2)
            self.assertEqual(refreshed["server"], "http://198.51.100.41:18080")

    def test_video_preflight_rejects_a_lease_with_less_than_two_minutes(self):
        def fake_urlopen(_url, timeout):
            self.assertGreater(timeout, 0)
            return _Response({
                "success": True,
                "proxy": "198.51.100.42:18080",
                "location": 1,
                "next_change": "120",
                "timeout": "641",
            })

        with tempfile.TemporaryDirectory() as directory:
            manager = proxy_manager.ProxyManager(Path(directory) / "pool.db")
            manager._conn.execute(
                "INSERT INTO accounts_meta(name,created_at) VALUES(?,?)",
                ("profile-a", 0),
            )
            manager._conn.commit()
            with patch.object(proxy_manager, "urlopen", side_effect=fake_urlopen):
                _, proxy = manager.create_proxyfb(
                    name="ProxyFB short lease",
                    api_key="short-lease-key",
                    location_id="1",
                )
            manager.assign("profile-a", proxy["id"])
            now = proxy_manager.time.time()
            manager._conn.execute(
                "UPDATE proxy_profiles SET proxy_timeout_at=?, "
                "proxy_last_rotated_at=?, status='healthy', last_checked_at=? "
                "WHERE id=?",
                (now + 90, now, now, proxy["id"]),
            )
            manager._conn.commit()

            with patch.object(
                manager,
                "_ensure_proxyfb_current",
                side_effect=AssertionError("must skip before refresh"),
            ):
                with self.assertRaisesRegex(
                    proxy_manager.ProxyLeaseExpiringError, r"< 120s"
                ):
                    manager.proxy_for_account(
                        "profile-a", minimum_remaining_sec=120
                    )

    def test_background_rotation_skips_fresh_and_rotates_due_leases(self):
        calls = []

        def fake_urlopen(url, timeout):
            calls.append((url, timeout))
            endpoint = "198.51.100.60:18080" if len(calls) == 1 else "198.51.100.61:18080"
            return _Response({
                "success": True,
                "proxy": endpoint,
                "location": 1,
                "next_change": "120",
                "timeout": "641",
            })

        with tempfile.TemporaryDirectory() as directory:
            manager = proxy_manager.ProxyManager(Path(directory) / "pool.db")
            with patch.object(proxy_manager, "urlopen", side_effect=fake_urlopen):
                _, proxy = manager.create_proxyfb(
                    name="ProxyFB scheduler",
                    api_key="scheduler-secret-key",
                    location_id="1",
                )
                fresh = manager.rotate_due_proxyfb()
                self.assertEqual(len(fresh["rotated"]), 0)
                self.assertEqual(len(fresh["skipped"]), 1)

                now = proxy_manager.time.time()
                manager._conn.execute(
                    "UPDATE proxy_profiles SET proxy_next_change_at=?, "
                    "proxy_timeout_at=? WHERE id=?",
                    (
                        now - 1,
                        now + proxy_manager.PROXYFB_REFRESH_MARGIN_SEC - 1,
                        proxy["id"],
                    ),
                )
                manager._conn.commit()
                due = manager.rotate_due_proxyfb()

            self.assertEqual(len(due["rotated"]), 1)
            self.assertEqual(len(due["failed"]), 0)
            self.assertEqual(due["rotated"][0]["host"], "198.51.100.61")
            self.assertEqual(len(calls), 2)

    def test_unhealthy_proxy_rotates_when_provider_allows_it(self):
        calls = []

        def fake_urlopen(url, timeout):
            calls.append((url, timeout))
            endpoint = "198.51.100.72:18080" if len(calls) == 1 else "198.51.100.73:18080"
            return _Response({
                "success": True,
                "proxy": endpoint,
                "location": 1,
                "next_change": "120",
                "timeout": "3600",
            })

        with tempfile.TemporaryDirectory() as directory:
            manager = proxy_manager.ProxyManager(Path(directory) / "pool.db")
            with patch.object(proxy_manager, "urlopen", side_effect=fake_urlopen):
                _, proxy = manager.create_proxyfb(
                    name="ProxyFB early failure",
                    api_key="early-failure-secret-key",
                    location_id="1",
                )
                now = proxy_manager.time.time()
                manager._conn.execute(
                    "UPDATE proxy_profiles SET proxy_last_rotated_at=?, "
                    "proxy_next_change_at=?, proxy_timeout_at=?, "
                    "status='healthy', last_checked_at=? WHERE id=?",
                    (now - 60, now - 1, now + 30 * 60, now - 121, proxy["id"]),
                )
                manager._conn.commit()

                async def report_failed_health_check(rows, timeout):
                    del timeout
                    return [manager._checker_error(row, "Proxy Checker xác nhận proxy không hoạt động.") for row in rows]

                original_test_batch = manager._test_batch
                manager._test_batch = report_failed_health_check
                try:
                    health = asyncio.run(manager.test_many([proxy["id"]]))
                finally:
                    manager._test_batch = original_test_batch
                self.assertEqual(health["summary"]["failed"], 1)
                self.assertEqual(manager.list_public()[0]["status"], "error")

                # The automatic rotator must not change a shared endpoint while
                # an existing render still owns it; it rotates on the next idle scan.
                active = manager.rotate_due_proxyfb(active_proxy_ids={proxy["id"]})
                self.assertEqual(active["deferred"][0]["proxy_id"], proxy["id"])
                self.assertEqual(len(calls), 1)

                recovered = manager.rotate_due_proxyfb()

            self.assertEqual(len(recovered["rotated"]), 1)
            self.assertEqual(recovered["rotated"][0]["host"], "198.51.100.73")
            self.assertEqual(len(calls), 2)

    def test_proxyfb_ip_check_waits_for_activation(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = proxy_manager.ProxyManager(Path(directory) / "pool.db")
            candidate = {
                "host": "198.51.100.62",
                "port": 18080,
                "username": "",
                "password_encrypted": "",
                "status": "unknown",
                "last_checked_at": 0,
                "proxy_last_rotated_at": 0,
            }
            with patch.object(proxy_manager, "PROXYFB_IP_ACTIVATION_WAIT_SEC", 60), \
                    patch.object(proxy_manager.time, "time", return_value=1000), \
                    patch.object(proxy_manager.time, "sleep") as sleep:
                manager._wait_and_check_proxyfb_endpoint(
                    candidate, changed_at=950, force_check=True
                )

            sleep.assert_called_once_with(10)

    def test_bulk_rotation_keeps_processing_after_non_proxyfb_row(self):
        calls = []

        def fake_urlopen(url, timeout):
            calls.append((url, timeout))
            endpoint = "198.51.100.70:18080" if len(calls) == 1 else "198.51.100.71:18080"
            return _Response({
                "success": True,
                "proxy": endpoint,
                "location": 1,
                "next_change": "120",
                "timeout": "641",
            })

        with tempfile.TemporaryDirectory() as directory:
            manager = proxy_manager.ProxyManager(Path(directory) / "pool.db")
            with patch.object(proxy_manager, "urlopen", side_effect=fake_urlopen):
                _, proxyfb = manager.create_proxyfb(
                    name="ProxyFB bulk",
                    api_key="bulk-secret-key",
                    location_id="1",
                )
            static = manager.create_or_update({
                "name": "Static proxy",
                "protocol": "HTTP",
                "mode": "static",
                "host": "198.51.100.80",
                "port": 18080,
            })

            with patch.object(proxy_manager, "urlopen", side_effect=fake_urlopen):
                result = manager.rotate_proxyfb_many([proxyfb["id"], static["id"]])

            self.assertEqual(result["summary"], {
                "requested": 2,
                "rotated": 1,
                "skipped": 1,
                "failed": 0,
            })
            self.assertEqual(result["rotated"][0]["host"], "198.51.100.71")
            self.assertEqual(result["skipped"][0]["proxy_id"], static["id"])
            self.assertEqual(len(calls), 2)

    def test_proxyfb_does_not_reuse_stale_endpoint_when_change_fails(self):
        def fake_urlopen(_url, timeout):
            self.assertGreater(timeout, 0)
            raise OSError("ProxyFB unavailable")

        with tempfile.TemporaryDirectory() as directory:
            manager = proxy_manager.ProxyManager(Path(directory) / "pool.db")
            manager._conn.execute(
                "INSERT INTO accounts_meta(name,created_at) VALUES(?,?)",
                ("profile-a", 0),
            )
            manager._conn.commit()
            with patch.object(proxy_manager, "urlopen", return_value=_Response({
                "success": True,
                "proxy": "198.51.100.50:18080",
                "location": 1,
                "next_change": "120",
                "timeout": "641",
            })):
                _, proxy = manager.create_proxyfb(
                    name="ProxyFB stale",
                    api_key="stale-secret-key",
                    location_id="1",
                )
            manager.assign("profile-a", proxy["id"])
            manager._conn.execute(
                "UPDATE proxy_profiles SET proxy_last_rotated_at=?, "
                "proxy_next_change_at=?, proxy_timeout_at=? WHERE id=?",
                (
                    proxy_manager.time.time(),
                    proxy_manager.time.time() - 1,
                    proxy_manager.time.time() + proxy_manager.PROXYFB_REFRESH_MARGIN_SEC - 1,
                    proxy["id"],
                ),
            )
            manager._conn.commit()
            with patch.object(proxy_manager, "urlopen", side_effect=fake_urlopen):
                with self.assertRaises(proxy_manager.ProxyFBError):
                    manager.proxy_for_account("profile-a")

    def test_rename_preserves_proxyfb_source_secret_and_assignments(self):
        def fake_urlopen(_url, timeout):
            self.assertGreater(timeout, 0)
            return _Response(
                {
                    "success": True,
                    "proxy": "198.51.100.30:18080",
                    "location": 1,
                    "next_change": "120",
                    "timeout": "641",
                }
            )

        with tempfile.TemporaryDirectory() as directory:
            manager = proxy_manager.ProxyManager(Path(directory) / "pool.db")
            manager._conn.execute(
                "INSERT INTO accounts_meta(name,created_at) VALUES(?,?)",
                ("profile-a", 0),
            )
            manager._conn.commit()
            with patch.object(proxy_manager, "urlopen", side_effect=fake_urlopen):
                _, proxy = manager.create_proxyfb(
                    name="ProxyFB original",
                    api_key="rename-secret-key",
                    location_id="1",
                )
            manager.assign("profile-a", proxy["id"])
            before = manager._conn.execute(
                "SELECT source, source_key_encrypted, host, port FROM proxy_profiles WHERE id=?",
                (proxy["id"],),
            ).fetchone()

            renamed = manager.rename(proxy["id"], "Tokyo primary")
            after = manager._conn.execute(
                "SELECT source, source_key_encrypted, host, port, name FROM proxy_profiles WHERE id=?",
                (proxy["id"],),
            ).fetchone()

            self.assertEqual(renamed["name"], "Tokyo primary")
            self.assertEqual(after["name"], "Tokyo primary")
            self.assertEqual(after["source"], before["source"])
            self.assertEqual(after["source_key_encrypted"], before["source_key_encrypted"])
            self.assertEqual((after["host"], after["port"]), (before["host"], before["port"]))
            self.assertEqual(
                manager._conn.execute(
                    "SELECT proxy_id FROM accounts_meta WHERE name=?", ("profile-a",)
                ).fetchone()["proxy_id"],
                proxy["id"],
            )

    def test_assign_evenly_uses_round_robin_profile_order(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = proxy_manager.ProxyManager(Path(directory) / "pool.db")
            account_names = [f"profile-{index:02d}" for index in range(30)]
            manager._conn.executemany(
                "INSERT INTO accounts_meta(name,created_at) VALUES(?,?)",
                [(name, 0) for name in account_names],
            )
            manager._conn.commit()
            proxy_ids = []
            for index in range(5):
                proxy = manager.create_or_update(
                    {
                        "name": f"Proxy {index + 1}",
                        "protocol": "HTTP",
                        "mode": "rotating",
                        "host": f"198.51.100.{index + 1}",
                        "port": 18080 + index,
                    }
                )
                proxy_ids.append(proxy["id"])

            result = manager.assign_evenly(account_names, proxy_ids)

            self.assertEqual(result["updated"], 30)
            self.assertEqual([item["count"] for item in result["distribution"]], [6, 6, 6, 6, 6])
            self.assertEqual(
                [item["proxy_id"] for item in result["assignments"]],
                [proxy_ids[index % len(proxy_ids)] for index in range(len(account_names))],
            )
            rows = manager._conn.execute(
                "SELECT proxy_id, COUNT(*) AS count FROM accounts_meta GROUP BY proxy_id ORDER BY proxy_id"
            ).fetchall()
            self.assertEqual(sorted(int(row["count"]) for row in rows), [6, 6, 6, 6, 6])

    def test_assign_evenly_supports_more_than_one_thousand_profiles(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = proxy_manager.ProxyManager(Path(directory) / "pool.db")
            account_names = [f"profile-{index:04d}" for index in range(1200)]
            manager._conn.executemany(
                "INSERT INTO accounts_meta(name,created_at) VALUES(?,?)",
                [(name, 0) for name in account_names],
            )
            manager._conn.commit()
            proxy_ids = []
            for index in range(10):
                proxy = manager.create_or_update(
                    {
                        "name": f"Proxy {index + 1}",
                        "protocol": "HTTP",
                        "mode": "rotating",
                        "host": f"198.51.100.{index + 1}",
                        "port": 18100 + index,
                    }
                )
                proxy_ids.append(proxy["id"])

            result = manager.assign_evenly(account_names, proxy_ids)

            self.assertEqual(result["updated"], 1200)
            self.assertEqual([item["count"] for item in result["distribution"]], [120] * 10)
            self.assertEqual(
                manager._conn.execute(
                    "SELECT COUNT(*) FROM accounts_meta WHERE COALESCE(proxy_id, '')=''"
                ).fetchone()[0],
                0,
            )

    def test_assign_evenly_assigns_remainder_without_touching_other_profiles(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = proxy_manager.ProxyManager(Path(directory) / "pool.db")
            names = [f"selected-{index}" for index in range(7)]
            other = "outside-selection"
            manager._conn.executemany(
                "INSERT INTO accounts_meta(name,created_at,proxy_id) VALUES(?,?,?)",
                [(name, 0, "old") for name in names + [other]],
            )
            manager._conn.commit()
            proxy_ids = []
            for index in range(3):
                proxy = manager.create_or_update(
                    {
                        "name": f"Proxy {index + 1}",
                        "protocol": "HTTP",
                        "mode": "rotating",
                        "host": f"203.0.113.{index + 1}",
                        "port": 19080 + index,
                    }
                )
                proxy_ids.append(proxy["id"])

            result = manager.assign_evenly(names, proxy_ids)

            self.assertEqual([item["count"] for item in result["distribution"]], [3, 2, 2])
            self.assertEqual(
                [item["proxy_id"] for item in result["assignments"]],
                [proxy_ids[index % len(proxy_ids)] for index in range(len(names))],
            )
            self.assertEqual(
                manager._conn.execute(
                    "SELECT proxy_id FROM accounts_meta WHERE name=?", (other,)
                ).fetchone()["proxy_id"],
                "old",
            )

    def test_default_distribution_prefers_enabled_proxyfb_profiles(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = proxy_manager.ProxyManager(Path(directory) / "pool.db")
            names = [f"profile-{index}" for index in range(4)]
            manager._conn.executemany(
                "INSERT INTO accounts_meta(name,created_at) VALUES(?,?)",
                [(name, 0) for name in names],
            )
            manager._conn.commit()
            manual = manager.create_or_update(
                {
                    "name": "Manual fallback",
                    "protocol": "HTTP",
                    "mode": "rotating",
                    "host": "192.0.2.1",
                    "port": 18080,
                }
            )
            api_ids = []
            for index in range(2):
                proxy = manager.create_or_update(
                    {
                        "name": f"API {index + 1}",
                        "protocol": "HTTP",
                        "mode": "rotating",
                        "host": f"192.0.2.{index + 2}",
                        "port": 18081 + index,
                    }
                )
                api_ids.append(proxy["id"])
            manager._conn.executemany(
                "UPDATE proxy_profiles SET source='proxyfb' WHERE id=?",
                [(proxy_id,) for proxy_id in api_ids],
            )
            manager._conn.commit()

            result = manager.assign_evenly(names)

            self.assertEqual([item["proxy_id"] for item in result["distribution"]], api_ids)
            self.assertEqual([item["count"] for item in result["distribution"]], [2, 2])
            self.assertEqual(
                manager._conn.execute(
                    "SELECT COUNT(*) FROM accounts_meta WHERE proxy_id=?", (manual["id"],)
                ).fetchone()[0],
                0,
            )


if __name__ == "__main__":
    unittest.main()
