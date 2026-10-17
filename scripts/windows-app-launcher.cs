using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Sockets;
using System.Text.RegularExpressions;
using System.Windows.Forms;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new LauncherForm());
    }
}

internal sealed class LauncherForm : Form
{
    private readonly string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
    private readonly string appUrl = "http://127.0.0.1:3021/";
    private readonly Label statusLabel;
    private readonly Button openButton;
    private readonly Button downloadUpdateButton;
    private readonly Button installUpdateButton;
    private readonly Button stopButton;
    private readonly Timer pollTimer;
    private readonly object logLock = new object();
    private const string ReleasesUrl = "https://github.com/nghiencarcom/StoryDola/releases/latest";
    private Process appProcess;
    private bool browserOpened;
    private bool stopping;

    public LauncherForm()
    {
        Text = "StoryDola";
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = true;
        ClientSize = new Size(560, 214);
        Icon = SystemIcons.Application;

        var title = new Label();
        title.Text = "StoryDola";
        title.Font = new Font("Segoe UI", 15, FontStyle.Bold);
        title.AutoSize = true;
        title.Location = new Point(24, 18);

        statusLabel = new Label();
        statusLabel.Text = "Đang chuẩn bị ứng dụng...";
        statusLabel.Font = new Font("Segoe UI", 10, FontStyle.Regular);
        statusLabel.AutoSize = false;
        statusLabel.Size = new Size(510, 58);
        statusLabel.Location = new Point(26, 58);

        openButton = new Button();
        openButton.Text = "Mở StoryDola";
        openButton.Size = new Size(118, 36);
        openButton.Location = new Point(26, 148);
        openButton.Enabled = false;
        openButton.Click += delegate { OpenApp(); };

        downloadUpdateButton = new Button();
        downloadUpdateButton.Text = "Tải cập nhật";
        downloadUpdateButton.Size = new Size(118, 36);
        downloadUpdateButton.Location = new Point(154, 148);
        downloadUpdateButton.Click += delegate { OpenUpdatePage(); };

        installUpdateButton = new Button();
        installUpdateButton.Text = "Cài từ ZIP";
        installUpdateButton.Size = new Size(118, 36);
        installUpdateButton.Location = new Point(282, 148);
        installUpdateButton.Click += delegate { InstallUpdateFromZip(); };

        stopButton = new Button();
        stopButton.Text = "Dừng ứng dụng";
        stopButton.Size = new Size(120, 36);
        stopButton.Location = new Point(414, 148);
        stopButton.Enabled = false;
        stopButton.Click += delegate
        {
            StopApp();
            Close();
        };

        Controls.Add(title);
        Controls.Add(statusLabel);
        Controls.Add(openButton);
        Controls.Add(downloadUpdateButton);
        Controls.Add(installUpdateButton);
        Controls.Add(stopButton);

        pollTimer = new Timer();
        pollTimer.Interval = 700;
        pollTimer.Tick += PollApp;
        Shown += delegate { StartApp(); };
        FormClosing += delegate { StopApp(); };
    }

    private void StartApp()
    {
        try
        {
            string nodeDir = Path.Combine(root, "runtime", "node");
            string nodeExe = Path.Combine(nodeDir, "node.exe");
            string npmCli = Path.Combine(nodeDir, "node_modules", "npm", "bin", "npm-cli.js");
            string nodeScript = Path.Combine(root, "scripts", "dev-local.cjs");
            string pythonBase = Path.Combine(root, "runtime", "python");
            string venvConfig = Path.Combine(root, "dola-studio", "dola-render-gateway", ".venv", "pyvenv.cfg");
            string ffmpegDir = Path.Combine(root, "runtime", "ffmpeg", "bin");
            string ffmpegExe = Path.Combine(root, "ffmpeg.exe");
            string ffprobeExe = Path.Combine(root, "ffprobe.exe");

            RequireFile(nodeExe, "Node.js bundled runtime");
            RequireFile(npmCli, "npm bundled runtime");
            RequireFile(nodeScript, "StoryDola launcher script");
            RequireFile(Path.Combine(pythonBase, "python.exe"), "Python bundled runtime");
            RequireFile(venvConfig, "Dola Python environment");
            RequireFile(ffmpegExe, "FFmpeg");
            RequireFile(ffprobeExe, "FFprobe");

            SetPortablePythonHome(venvConfig, pythonBase);
            Directory.CreateDirectory(Path.Combine(root, "logs"));

            var startInfo = new ProcessStartInfo();
            startInfo.FileName = nodeExe;
            startInfo.Arguments = Quote(nodeScript);
            startInfo.WorkingDirectory = root;
            startInfo.UseShellExecute = false;
            startInfo.CreateNoWindow = true;
            startInfo.WindowStyle = ProcessWindowStyle.Hidden;
            startInfo.RedirectStandardOutput = true;
            startInfo.RedirectStandardError = true;

            string oldPath = startInfo.EnvironmentVariables["PATH"] ?? "";
            string pythonScripts = Path.Combine(root, "dola-studio", "dola-render-gateway", ".venv", "Scripts");
            startInfo.EnvironmentVariables["PATH"] = String.Join(";", new string[]
            {
                nodeDir,
                pythonBase,
                pythonScripts,
                root,
                ffmpegDir,
                oldPath
            });
            startInfo.EnvironmentVariables["npm_execpath"] = npmCli;
            startInfo.EnvironmentVariables["DOLA_GATEWAY_DETACHED"] = "0";
            startInfo.EnvironmentVariables["DOLA_FFMPEG_BINARY"] = ffmpegExe;
            startInfo.EnvironmentVariables["STORYAI_FFMPEG_PATH"] = ffmpegExe;
            startInfo.EnvironmentVariables["STORYAI_FFPROBE_PATH"] = ffprobeExe;
            startInfo.EnvironmentVariables.Remove("PYTHONHOME");
            startInfo.EnvironmentVariables.Remove("PYTHONPATH");

            appProcess = new Process();
            appProcess.StartInfo = startInfo;
            appProcess.EnableRaisingEvents = true;
            appProcess.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e)
            {
                if (e.Data != null) AppendLog(e.Data);
            };
            appProcess.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e)
            {
                if (e.Data != null) AppendLog(e.Data);
            };

            if (!appProcess.Start()) throw new InvalidOperationException("Không thể khởi chạy Node.js.");
            appProcess.BeginOutputReadLine();
            appProcess.BeginErrorReadLine();
            statusLabel.Text = "Đang khởi động StoryAI, Dola và các dịch vụ local. Lần đầu có thể mất vài phút.";
            stopButton.Enabled = true;
            pollTimer.Start();
            AppendLog("StoryDola launcher started. PID=" + appProcess.Id);
        }
        catch (Exception error)
        {
            statusLabel.Text = "Không khởi động được. Xem logs\\launcher.log để biết chi tiết.";
            AppendLog("Launcher error: " + error);
            MessageBox.Show(this, error.Message, "StoryDola không khởi động được", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void PollApp(object sender, EventArgs e)
    {
        if (appProcess != null)
        {
            try
            {
                if (appProcess.HasExited)
                {
                    pollTimer.Stop();
                    stopButton.Enabled = false;
                    statusLabel.Text = "Ứng dụng đã dừng. Xem logs\\launcher.log nếu cần kiểm tra lỗi.";
                    return;
                }
            }
            catch (InvalidOperationException) { }
        }

        if (!browserOpened && IsPortOpen(3021))
        {
            browserOpened = true;
            openButton.Enabled = true;
            statusLabel.Text = "StoryDola đang chạy tại localhost:3021. Đóng cửa sổ này để dừng toàn bộ dịch vụ.";
            OpenApp();
        }
    }

    private void OpenApp()
    {
        try
        {
            Process.Start(new ProcessStartInfo(appUrl) { UseShellExecute = true });
        }
        catch (Exception error)
        {
            MessageBox.Show(this, error.Message, "Không mở được trình duyệt", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void OpenUpdatePage()
    {
        try
        {
            Process.Start(new ProcessStartInfo(ReleasesUrl) { UseShellExecute = true });
            statusLabel.Text = "Trang Releases đã mở. Đăng nhập GitHub, tải ZIP mới nhất rồi chọn Cài từ ZIP.";
        }
        catch (Exception error)
        {
            MessageBox.Show(this, error.Message, "Không mở được trang cập nhật", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void InstallUpdateFromZip()
    {
        string updateScript = Path.Combine(root, "scripts", "apply-update.ps1");
        if (!File.Exists(updateScript))
        {
            MessageBox.Show(this, "Thiếu scripts\\apply-update.ps1. Hãy giải nén lại gói StoryDola đầy đủ.", "Không tìm thấy bộ cập nhật", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        using (var picker = new OpenFileDialog())
        {
            picker.Title = "Chọn ZIP cập nhật StoryDola";
            picker.Filter = "StoryDola update (*.zip)|*.zip|All files (*.*)|*.*";
            picker.CheckFileExists = true;
            picker.Multiselect = false;
            if (picker.ShowDialog(this) != DialogResult.OK) return;

            DialogResult confirm = MessageBox.Show(
                this,
                "StoryDola sẽ dừng và cài bản ZIP đã chọn vào một thư mục phiên bản mới. Cấu hình, dữ liệu, database và profile của máy này sẽ được giữ lại. Tiếp tục?",
                "Cài cập nhật StoryDola",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question);
            if (confirm != DialogResult.Yes) return;

            try
            {
                string powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe");
                if (!File.Exists(powershell)) powershell = "powershell.exe";
                int launcherPid = Process.GetCurrentProcess().Id;
                var startInfo = new ProcessStartInfo();
                startInfo.FileName = powershell;
                startInfo.Arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File " + Quote(updateScript)
                    + " -ArchivePath " + Quote(picker.FileName)
                    + " -CurrentRoot " + Quote(root)
                    + " -LauncherPid " + launcherPid;
                startInfo.UseShellExecute = false;
                startInfo.CreateNoWindow = true;
                startInfo.WindowStyle = ProcessWindowStyle.Hidden;
                Process.Start(startInfo);
                statusLabel.Text = "Đang chuẩn bị cập nhật. Ứng dụng sẽ tự mở lại sau khi cài xong.";
                StopApp();
                Close();
            }
            catch (Exception error)
            {
                MessageBox.Show(this, error.Message, "Không thể khởi chạy bộ cập nhật", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }

    private void StopApp()
    {
        if (stopping) return;
        stopping = true;
        pollTimer.Stop();
        stopButton.Enabled = false;

        try
        {
            if (appProcess != null && !appProcess.HasExited)
            {
                statusLabel.Text = "Đang dừng StoryAI, Gateway và tiến trình con...";
                KillProcessTree(appProcess.Id);
                if (!appProcess.WaitForExit(10000)) appProcess.Kill();
            }
        }
        catch (Exception error)
        {
            AppendLog("Stop error: " + error);
        }
        finally
        {
            AppendLog("StoryDola launcher stopped.");
        }
    }

    private void KillProcessTree(int pid)
    {
        string taskkill = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "taskkill.exe");
        var startInfo = new ProcessStartInfo(taskkill, "/PID " + pid + " /T /F");
        startInfo.UseShellExecute = false;
        startInfo.CreateNoWindow = true;
        startInfo.WindowStyle = ProcessWindowStyle.Hidden;
        using (Process killer = Process.Start(startInfo))
        {
            if (killer != null) killer.WaitForExit(10000);
        }
    }

    private void SetPortablePythonHome(string configPath, string pythonBase)
    {
        string[] lines = File.ReadAllLines(configPath);
        bool homeWritten = false;
        bool executableWritten = false;
        string pythonExe = Path.Combine(pythonBase, "python.exe");
        for (int i = 0; i < lines.Length; i++)
        {
            if (Regex.IsMatch(lines[i], @"^\s*home\s*=", RegexOptions.IgnoreCase))
            {
                lines[i] = "home = " + pythonBase;
                homeWritten = true;
            }
            else if (Regex.IsMatch(lines[i], @"^\s*executable\s*=", RegexOptions.IgnoreCase))
            {
                lines[i] = "executable = " + pythonExe;
                executableWritten = true;
            }
        }

        if (!homeWritten) Array.Resize(ref lines, lines.Length + 1);
        if (!homeWritten) lines[lines.Length - 1] = "home = " + pythonBase;
        if (!executableWritten)
        {
            Array.Resize(ref lines, lines.Length + 1);
            lines[lines.Length - 1] = "executable = " + pythonExe;
        }
        File.WriteAllLines(configPath, lines);
    }

    private bool IsPortOpen(int port)
    {
        try
        {
            using (var client = new TcpClient())
            {
                IAsyncResult result = client.BeginConnect("127.0.0.1", port, null, null);
                bool connected = result.AsyncWaitHandle.WaitOne(250);
                if (!connected) return false;
                client.EndConnect(result);
                return client.Connected;
            }
        }
        catch { return false; }
    }

    private void RequireFile(string path, string label)
    {
        if (!File.Exists(path)) throw new FileNotFoundException("Thiếu " + label + ": " + path, path);
    }

    private string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }

    private void AppendLog(string message)
    {
        try
        {
            string logPath = Path.Combine(root, "logs", "launcher.log");
            lock (logLock)
            {
                File.AppendAllText(logPath, "[" + DateTime.Now.ToString("s") + "] " + message + Environment.NewLine);
            }
        }
        catch { }
    }
}
