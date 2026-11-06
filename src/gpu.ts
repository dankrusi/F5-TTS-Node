import { execFile } from 'node:child_process';
import { listSupportedBackends } from 'onnxruntime-node';

/** A DXGI display adapter usable by the DirectML execution provider. */
export interface GpuAdapter {
  /** DXGI adapter index; this is the DirectML `deviceId`. */
  index: number;
  name: string;
  vendorId: number;
  dedicatedMemoryBytes: number;
  /** Software rasterizers such as "Microsoft Basic Render Driver". */
  software: boolean;
}

// Enumerates adapters in DXGI order (the order DirectML's deviceId refers to) via COM
// interop, so no native addon is needed. Methods before the ones called are vtable placeholders.
const DXGI_SCRIPT = String.raw`$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class F5Dxgi{
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public struct DESC1{[MarshalAs(UnmanagedType.ByValTStr,SizeConst=128)]public string Description;public uint VendorId,DeviceId,SubSysId,Revision;public UIntPtr DedicatedVideoMemory,DedicatedSystemMemory,SharedSystemMemory;public uint LuidLow;public int LuidHigh;public uint Flags;}
 [ComImport,Guid("29038f61-3839-4626-91fd-086879011a05"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAdapter1{void SetPrivateData();void SetPrivateDataInterface();void GetPrivateData();void GetParent();void EnumOutputs();void GetDesc();void CheckInterfaceSupport();[PreserveSig]int GetDesc1(out DESC1 d);}
 [ComImport,Guid("770aae78-f26f-4dba-a829-253c83d1b387"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IFactory1{void SetPrivateData();void SetPrivateDataInterface();void GetPrivateData();void GetParent();void EnumAdapters();void MakeWindowAssociation();void GetWindowAssociation();void CreateSwapChain();void CreateSoftwareAdapter();[PreserveSig]int EnumAdapters1(uint i,out IAdapter1 a);}
 [DllImport("dxgi.dll")] static extern int CreateDXGIFactory1(ref Guid g,[MarshalAs(UnmanagedType.Interface)]out IFactory1 f);
 public static string List(){Guid g=new Guid("770aae78-f26f-4dba-a829-253c83d1b387");IFactory1 f;Marshal.ThrowExceptionForHR(CreateDXGIFactory1(ref g,out f));var sb=new System.Text.StringBuilder();
  for(uint i=0;;i++){IAdapter1 a;if(f.EnumAdapters1(i,out a)!=0)break;DESC1 d;Marshal.ThrowExceptionForHR(a.GetDesc1(out d));sb.Append(i).Append('\t').Append(d.VendorId).Append('\t').Append(d.DedicatedVideoMemory.ToUInt64()).Append('\t').Append(d.Flags).Append('\t').Append(d.Description.Replace('\t',' ')).Append('\n');Marshal.ReleaseComObject(a);}
  Marshal.ReleaseComObject(f);return sb.ToString();}
}
'@
[Console]::Out.Write([F5Dxgi]::List())`;

let cached: Promise<GpuAdapter[]> | undefined;

/** Whether this ONNX Runtime build ships the DirectML provider (Windows x64/arm64). */
export function directMLAvailable(): boolean {
  if (process.platform !== 'win32') return false;
  try { return listSupportedBackends().some(backend => backend.name === 'dml'); } catch { return false; }
}

/** List DXGI adapters in DirectML device order. Empty off Windows or if enumeration fails. */
export function listGpuAdapters(): Promise<GpuAdapter[]> {
  if (process.platform !== 'win32') return Promise.resolve([]);
  return cached ??= new Promise(resolve => {
    const encoded = Buffer.from(DXGI_SCRIPT, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 30000 }, (error, stdout) => {
        if (error) { resolve([]); return; }
        resolve(stdout.split(/\r?\n/).filter(Boolean).map(line => {
          const [index, vendorId, memory, flags, ...name] = line.split('\t');
          return { index: Number(index), vendorId: Number(vendorId), dedicatedMemoryBytes: Number(memory),
            software: (Number(flags) & 2) !== 0, name: name.join(' ').trim() };
        }).filter(adapter => Number.isInteger(adapter.index)));
      });
  });
}

/** The hardware adapter with the most dedicated memory: normally the discrete GPU. */
export async function preferredGpuAdapter(): Promise<GpuAdapter | undefined> {
  const hardware = (await listGpuAdapters()).filter(adapter => !adapter.software);
  return hardware.sort((a, b) => b.dedicatedMemoryBytes - a.dedicatedMemoryBytes || a.index - b.index)[0];
}
