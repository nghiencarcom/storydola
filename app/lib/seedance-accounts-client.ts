"use client";

import { useCallback, useEffect, useState } from "react";

export type SeedanceAccountClient = {
  id: string;
  name: string;
  lastFour: string;
  createdAt: string;
  isDefault: boolean;
};

type SeedanceAccountPayload = {
  accounts: SeedanceAccountClient[];
  defaultAccountId: string;
  encryptionReady: boolean;
};

export function useSeedanceAccounts() {
  const [accounts, setAccounts] = useState<SeedanceAccountClient[]>([]);
  const [defaultAccountId, setDefaultAccountId] = useState("");
  const [encryptionReady, setEncryptionReady] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/seedance/accounts", { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as Partial<SeedanceAccountPayload>;
      if (!response.ok) throw new Error("Không tải được tài khoản Seedance.");
      setAccounts(Array.isArray(payload.accounts) ? payload.accounts : []);
      setDefaultAccountId(typeof payload.defaultAccountId === "string" ? payload.defaultAccountId : "");
      setEncryptionReady(payload.encryptionReady === true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh().catch(() => undefined); }, [refresh]);

  return { accounts, defaultAccountId, encryptionReady, loading, refresh };
}
