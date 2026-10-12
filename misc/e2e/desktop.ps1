param([string]$desktop, [string]$exe, [string]$cwd, [int]$procId, [string]$out)
Add-Type -ReferencedAssemblies System.Drawing @"
using System;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Drawing.Imaging;
using System.Threading;
public class E2eDesk {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct STARTUPINFO { public int cb; public string lpReserved; public string lpDesktop; public string lpTitle; public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags; public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
  [StructLayout(LayoutKind.Sequential)]
  public struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
  public struct RECT { public int L, T, R, B; }
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern IntPtr CreateDesktop(string name, IntPtr device, IntPtr devmode, int flags, uint access, IntPtr sa);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern IntPtr OpenDesktop(string name, int flags, bool inherit, uint access);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetThreadDesktop(IntPtr desk);
  [DllImport("user32.dll")] public static extern bool EnumDesktopWindows(IntPtr desk, EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint f);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool CreateProcess(string app, string cmd, IntPtr pa, IntPtr ta, bool inherit, int flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);

  public static IntPtr Desk(string name) {
    IntPtr d = OpenDesktop(name, 0, false, 0x10000000);
    if (d == IntPtr.Zero) d = CreateDesktop(name, IntPtr.Zero, IntPtr.Zero, 0, 0x10000000, IntPtr.Zero);
    if (d == IntPtr.Zero) throw new Exception("desktop " + Marshal.GetLastWin32Error());
    return d;
  }

  public static int Launch(string name, string exe, string cwd) {
    Desk(name);
    STARTUPINFO si = new STARTUPINFO();
    si.cb = Marshal.SizeOf(si);
    si.lpDesktop = "WinSta0\\" + name;
    PROCESS_INFORMATION pi;
    if (!CreateProcess(exe, "\"" + exe + "\"", IntPtr.Zero, IntPtr.Zero, false, 0, IntPtr.Zero, cwd, ref si, out pi)) throw new Exception("CreateProcess " + Marshal.GetLastWin32Error());
    return pi.dwProcessId;
  }

  public static string Shot(string name, int pid, string outPath) {
    string error = null;
    Thread t = new Thread(() => {
      try {
        SetProcessDPIAware();
        IntPtr desk = Desk(name);
        if (!SetThreadDesktop(desk)) throw new Exception("SetThreadDesktop " + Marshal.GetLastWin32Error());
        IntPtr h = Find(desk, pid);
        if (h == IntPtr.Zero) throw new Exception("no window");
        RECT r; GetWindowRect(h, out r);
        using (Bitmap bmp = new Bitmap(r.R - r.L, r.B - r.T)) {
          using (Graphics g = Graphics.FromImage(bmp)) {
            IntPtr hdc = g.GetHdc();
            PrintWindow(h, hdc, 2);
            g.ReleaseHdc(hdc);
          }
          bmp.Save(outPath, ImageFormat.Png);
        }
      } catch (Exception e) { error = e.Message; }
    });
    t.Start();
    t.Join();
    return error;
  }

  public static IntPtr Find(IntPtr desk, int pid) {
    IntPtr found = IntPtr.Zero;
    EnumDesktopWindows(desk, (h, p) => {
      int wpid; GetWindowThreadProcessId(h, out wpid);
      RECT r; GetWindowRect(h, out r);
      if (wpid == pid && IsWindowVisible(h) && r.R - r.L > 200) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
if ($exe) {
  [E2eDesk]::Launch($desktop, $exe, $cwd)
  exit 0
}
$err = [E2eDesk]::Shot($desktop, $procId, $out)
if ($err) { Write-Error $err; exit 1 }
