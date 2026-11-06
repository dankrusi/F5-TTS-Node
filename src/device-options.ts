import type { Device } from './engine.js';

/** Shared CLI/demo flags. Undefined device preserves the engine's environment fallback. */
export function deviceOptions(values: { cpu?: boolean; gpu?: boolean; device?: string; 'gpu-device'?: string }): { device?: Device; gpuDeviceId?: number } {
  const selections = Number(values.cpu === true) + Number(values.gpu === true) + Number(values.device !== undefined);
  if (selections > 1) throw new Error('Choose only one of --cpu, --gpu, or --device.');
  const device = values.cpu ? 'cpu' : values.gpu ? 'gpu' : values.device;
  if (device !== undefined && !['auto', 'cpu', 'gpu'].includes(device)) throw new Error('--device must be auto, cpu or gpu');
  const adapter = values['gpu-device'];
  if (adapter !== undefined && (!/^\d+$/.test(adapter) || !Number.isSafeInteger(Number(adapter)))) throw new Error('--gpu-device must be a non-negative integer');
  if (device === 'cpu' && adapter !== undefined) throw new Error('--gpu-device cannot be used with CPU mode');
  return { device: device as Device | undefined, gpuDeviceId: adapter === undefined ? undefined : Number(adapter) };
}
