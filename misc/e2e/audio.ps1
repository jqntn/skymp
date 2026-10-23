param([int[]]$mutePids = @(), [switch]$unmute, [string]$watchDir = "", [int]$parentPid = 0)
Add-Type -Language CSharp @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class E2eAudio {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}
  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator { [PreserveSig] int EnumAudioEndpoints(int dataFlow, int mask, out IMMDeviceCollection devices); }
  [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceCollection { [PreserveSig] int GetCount(out int count); [PreserveSig] int Item(int index, out IMMDevice device); }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice { [PreserveSig] int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
  [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 { int A(); int B(); [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator e); }
  [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator { [PreserveSig] int GetCount(out int n); [PreserveSig] int GetSession(int i, out IAudioSessionControl2 s); }
  [Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    [PreserveSig] int GetState(out int state); int a(); int b(); int c(); int d(); int e(); int f(); int g(); int h();
    int i(); int j(); [PreserveSig] int GetProcessId(out uint pid);
  }
  [Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ISimpleAudioVolume {
    [PreserveSig] int SetMasterVolume(float v, ref Guid ctx); [PreserveSig] int GetMasterVolume(out float v);
    [PreserveSig] int SetMute(bool m, ref Guid ctx); [PreserveSig] int GetMute(out bool m);
  }
  public static List<string> Run(HashSet<uint> mute, bool unmute) {
    var rows = new List<string>();
    var en = (IMMDeviceEnumerator)new MMDeviceEnumerator();
    IMMDeviceCollection devices; en.EnumAudioEndpoints(0, 1, out devices);
    int nd; devices.GetCount(out nd);
    for (int d = 0; d < nd; d++) {
      IMMDevice dev; devices.Item(d, out dev);
      var iid = typeof(IAudioSessionManager2).GUID; object o;
      if (dev.Activate(ref iid, 23, IntPtr.Zero, out o) != 0) continue;
      IAudioSessionEnumerator se; ((IAudioSessionManager2)o).GetSessionEnumerator(out se);
      int n; se.GetCount(out n);
      for (int i = 0; i < n; i++) {
        IAudioSessionControl2 s; se.GetSession(i, out s);
        uint pid; s.GetProcessId(out pid); int state; s.GetState(out state);
        var vol = (ISimpleAudioVolume)s; bool m; vol.GetMute(out m); float v; vol.GetMasterVolume(out v);
        var g = Guid.Empty;
        if (mute.Contains(pid) && m == unmute) { vol.SetMute(!unmute, ref g); vol.GetMute(out m); }
        rows.Add(string.Format("device {0} pid {1} state {2} mute {3} volume {4:0.00}", d, pid, state, m, v));
      }
    }
    return rows;
  }
}
"@
$set = New-Object 'System.Collections.Generic.HashSet[uint32]'
foreach ($p in $mutePids) { [void]$set.Add([uint32]$p) }
if ($watchDir) {
  while (Get-Process -Id $parentPid -ErrorAction SilentlyContinue) {
    $set.Clear()
    Get-Process SkyrimSE -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$watchDir*" } | ForEach-Object { [void]$set.Add([uint32]$_.Id) }
    if ($set.Count) { try { [void][E2eAudio]::Run($set, $false) } catch {} }
    Start-Sleep -Milliseconds 300
  }
  exit 0
}
foreach ($r in [E2eAudio]::Run($set, [bool]$unmute)) {
  $procId = [int]($r -split ' ')[3]
  $name = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
  "$r $name"
}
