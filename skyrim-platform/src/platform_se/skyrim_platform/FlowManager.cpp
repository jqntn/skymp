#include "FlowManager.h"

void FlowManager::CloseProcessTree()
{
  const DWORD self = GetCurrentProcessId();

  HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);

  PROCESSENTRY32W entry;
  entry.dwSize = sizeof entry;

  for (BOOL ok = Process32FirstW(snap, &entry); ok;
       ok = Process32NextW(snap, &entry)) {
    if (entry.th32ParentProcessID != self) {
      continue;
    }
    if (HANDLE h = OpenProcess(PROCESS_TERMINATE, FALSE, entry.th32ProcessID)) {
      TerminateProcess(h, 0);
      CloseHandle(h);
    }
  }
  CloseHandle(snap);

  TerminateProcess(GetCurrentProcess(), 0);
}
