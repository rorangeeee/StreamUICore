using System.Runtime.InteropServices;

namespace StreamUI.DesktopAudio;

public record AudioDevice(string Id, string Name, int Channels, int SampleRate, bool IsDefault);

/// <summary>Windows Core Audio shared-mode loopback; all COM objects stay on their owning capture thread.</summary>
public sealed class Wasapi : IDisposable
{
    private IMMDeviceEnumerator? enumerator;
    private IMMDevice? device;
    private IAudioClient? client;
    private IAudioCaptureClient? capture;
    private IntPtr format;
    private bool comInitialized;
    public string DeviceId { get; private set; } = "";
    public int SampleRate { get; private set; }
    public int DeviceSampleRate { get; private set; }
    public int Channels { get; private set; }
    private int bits, blockAlign;
    private bool floatingPoint;

    public Wasapi(string deviceId)
    {
        try
        {
            Marshal.ThrowExceptionForHR(CoInitializeEx(IntPtr.Zero, 0));
            comInitialized = true;
            enumerator = (IMMDeviceEnumerator)new DeviceEnumerator();
            if (deviceId == "default") enumerator.GetDefaultAudioEndpoint(0, 1, out device);
            else enumerator.GetDevice(deviceId, out device);
            device.GetId(out var id);
            DeviceId = id;
            var iid = typeof(IAudioClient).GUID;
            device.Activate(ref iid, 23, IntPtr.Zero, out var activated);
            client = (IAudioClient)activated;
            client.GetMixFormat(out format);
            Channels = (ushort)Marshal.ReadInt16(format, 2);
            DeviceSampleRate = Marshal.ReadInt32(format, 4);
            SampleRate = 48000;
            blockAlign = (ushort)Marshal.ReadInt16(format, 12);
            bits = (ushort)Marshal.ReadInt16(format, 14);
            var tag = (ushort)Marshal.ReadInt16(format);
            if (tag == 0xfffe)
            {
                var subtype = Marshal.PtrToStructure<Guid>(format + 24);
                if (subtype != new Guid("00000001-0000-0010-8000-00aa00389b71") && subtype != new Guid("00000003-0000-0010-8000-00aa00389b71"))
                    throw new NotSupportedException("输出设备的音频格式不支持，请选择 PCM 输出设备。");
                tag = (ushort)subtype.ToByteArray()[0];
            }
            floatingPoint = tag == 3;
            if ((floatingPoint && bits != 32) || (!floatingPoint && (tag != 1 || bits is not (16 or 24 or 32))) || Channels < 1 || blockAlign < Channels * bits / 8)
                throw new NotSupportedException($"不支持该音频格式：{tag} / {bits} bit。");
            // Keep the endpoint's native channel layout and sample type, but request
            // 48 kHz through Windows' sample-rate converter. A 384 kHz endpoint must
            // not reduce the FFT's audible-band resolution by a factor of eight.
            Marshal.WriteInt32(format, 4, SampleRate);
            Marshal.WriteInt32(format, 8, SampleRate * blockAlign);
            client.Initialize(0, 0x88020000, 1_000_000, 0, format, IntPtr.Zero); // shared / LOOPBACK / AUTOCONVERTPCM / SRC_DEFAULT_QUALITY
            var captureId = typeof(IAudioCaptureClient).GUID;
            client.GetService(ref captureId, out var service);
            capture = (IAudioCaptureClient)service;
            client.Start();
        }
        catch { Dispose(); throw; }
    }

    public unsafe int Drain(AudioAnalysis analysis, int channel, double gain)
    {
        if (channel >= Channels) throw new ArgumentException($"所选设备只有 {Channels} 个声道，请重新选择声道。");
        int total = 0;
        capture!.GetNextPacketSize(out var available);
        while (available > 0)
        {
            capture.GetBuffer(out var data, out var frames, out var flags, out _, out _);
            try
            {
                for (int i = 0; i < frames; i++)
                {
                    double value = 0;
                    if ((flags & 2) == 0 && data != IntPtr.Zero)
                    {
                        var frame = (byte*)data + i * blockAlign;
                        int first = channel < 0 ? 0 : channel;
                        int last = channel < 0 ? Channels : channel + 1;
                        for (int c = first; c < last; c++)
                        {
                            var sample = frame + c * bits / 8;
                            value += floatingPoint ? *(float*)sample : bits switch
                            {
                                16 => *(short*)sample / 32768.0,
                                24 => ((sample[0] | sample[1] << 8 | sample[2] << 16) << 8 >> 8) / 8388608.0,
                                32 => *(int*)sample / 2147483648.0,
                                _ => 0,
                            };
                        }
                        value /= last - first;
                    }
                    analysis.Push((float)(value * gain));
                }
                total += (int)frames;
            }
            finally { capture.ReleaseBuffer(frames); }
            capture.GetNextPacketSize(out available);
        }
        return total;
    }

    public bool IsStillDefault()
    {
        enumerator!.GetDefaultAudioEndpoint(0, 1, out var current);
        try { current.GetId(out var id); return id == DeviceId; }
        finally { Release(current); }
    }

    public static AudioDevice[] Devices()
    {
        Marshal.ThrowExceptionForHR(CoInitializeEx(IntPtr.Zero, 0));
        IMMDeviceEnumerator? enumerator = null;
        IMMDeviceCollection? collection = null;
        try
        {
            enumerator = (IMMDeviceEnumerator)new DeviceEnumerator();
            string defaultId = "";
            try { enumerator.GetDefaultAudioEndpoint(0, 1, out var current); try { current.GetId(out defaultId); } finally { Release(current); } }
            catch (COMException) { }
            enumerator.EnumAudioEndpoints(0, 1, out collection);
            collection.GetCount(out var count);
            var result = new List<AudioDevice>();
            for (uint i = 0; i < count; i++)
            {
                collection.Item(i, out var device);
                IPropertyStore? properties = null;
                IAudioClient? client = null;
                IntPtr format = IntPtr.Zero;
                try
                {
                    device.GetId(out var id);
                    device.OpenPropertyStore(0, out properties);
                    var key = new PropertyKey { FormatId = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), Id = 14 };
                    properties.GetValue(ref key, out var value);
                    string name;
                    try { name = Marshal.PtrToStringUni(value.Pointer) ?? id; }
                    finally { PropVariantClear(ref value); }
                    int channels = 2, rate = 48000;
                    try
                    {
                        var iid = typeof(IAudioClient).GUID;
                        device.Activate(ref iid, 23, IntPtr.Zero, out var activated);
                        client = (IAudioClient)activated;
                        client.GetMixFormat(out format);
                        channels = (ushort)Marshal.ReadInt16(format, 2);
                        rate = Marshal.ReadInt32(format, 4);
                    }
                    catch (COMException) { }
                    result.Add(new(id, name, channels, rate, id == defaultId));
                }
                catch (COMException) { /* A device can disappear during enumeration. */ }
                finally { if (format != IntPtr.Zero) Marshal.FreeCoTaskMem(format); Release(client); Release(properties); Release(device); }
            }
            return result.ToArray();
        }
        finally { Release(collection); Release(enumerator); CoUninitialize(); }
    }

    public void Dispose()
    {
        try { client?.Stop(); } catch (COMException) { }
        Release(capture); Release(client); Release(device); Release(enumerator);
        capture = null; client = null; device = null; enumerator = null;
        if (format != IntPtr.Zero) { Marshal.FreeCoTaskMem(format); format = IntPtr.Zero; }
        if (comInitialized) { CoUninitialize(); comInitialized = false; }
    }
    private static void Release(object? value) { if (value is not null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value); }
    [DllImport("ole32.dll")] private static extern int CoInitializeEx(IntPtr reserved, uint mode);
    [DllImport("ole32.dll")] private static extern void CoUninitialize();
    [DllImport("ole32.dll")] private static extern int PropVariantClear(ref PropVariant value);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] internal class DeviceEnumerator { }
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDeviceEnumerator
{
    void EnumAudioEndpoints(int flow, uint mask, out IMMDeviceCollection devices);
    void GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device);
    void GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
}
[ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDeviceCollection { void GetCount(out uint count); void Item(uint index, out IMMDevice device); }
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDevice
{
    void Activate(ref Guid id, uint context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object value);
    void OpenPropertyStore(uint access, out IPropertyStore properties);
    void GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    void GetState(out uint state);
}
[StructLayout(LayoutKind.Sequential)] internal struct PropertyKey { public Guid FormatId; public uint Id; }
[StructLayout(LayoutKind.Explicit, Size = 24)] internal struct PropVariant { [FieldOffset(0)] public ushort Type; [FieldOffset(8)] public IntPtr Pointer; }
[ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IPropertyStore
{
    void GetCount(out uint count); void GetAt(uint index, out PropertyKey key);
    void GetValue(ref PropertyKey key, out PropVariant value);
}
[ComImport, Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioClient
{
    void Initialize(int mode, uint flags, long duration, long periodicity, IntPtr format, IntPtr session);
    void GetBufferSize(out uint frames); void GetStreamLatency(out long latency); void GetCurrentPadding(out uint frames);
    [PreserveSig] int IsFormatSupported(int mode, IntPtr format, out IntPtr closest);
    void GetMixFormat(out IntPtr format); void GetDevicePeriod(out long normal, out long minimum);
    void Start(); void Stop(); void Reset(); void SetEventHandle(IntPtr handle);
    void GetService(ref Guid id, [MarshalAs(UnmanagedType.IUnknown)] out object service);
}
[ComImport, Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioCaptureClient
{
    void GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong position, out ulong timestamp);
    void ReleaseBuffer(uint frames); void GetNextPacketSize(out uint frames);
}
