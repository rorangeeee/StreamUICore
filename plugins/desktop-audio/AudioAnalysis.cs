using System.Buffers.Binary;
using System.Numerics;
using System.Runtime.InteropServices;

namespace StreamUI.DesktopAudio;

/// <summary>8192 point Blackman FFT, with the same smoothing and dB scale as the former browser analyser.</summary>
public sealed class AudioAnalysis
{
    public const int Size = 8192;
    public const uint Magic = 0x41495553; // SUIA, little endian
    private readonly float[] ring = new float[Size];
    private readonly float[] smoothed = new float[Size / 2];
    private readonly Complex[] fft = new Complex[Size];
    private static readonly double[] Window = Enumerable.Range(0, Size).Select(i => .42 - .5 * Math.Cos(2 * Math.PI * i / Size) + .08 * Math.Cos(4 * Math.PI * i / Size)).ToArray();
    private static readonly Complex[] Twiddles = Enumerable.Range(0, Size / 2).Select(i => Complex.FromPolarCoordinates(1, -2 * Math.PI * i / Size)).ToArray();
    private int position;
    public void Push(float value) { ring[position] = float.IsFinite(value) ? Math.Clamp(value, -1, 1) : 0; position = (position + 1) % Size; }
    public byte[] Frame(int sampleRate)
    {
        var packet = new byte[16 + (Size + Size / 2) * sizeof(float)];
        BinaryPrimitives.WriteUInt32LittleEndian(packet, Magic);
        BinaryPrimitives.WriteInt32LittleEndian(packet.AsSpan(4), sampleRate);
        BinaryPrimitives.WriteInt32LittleEndian(packet.AsSpan(8), Size / 2);
        BinaryPrimitives.WriteInt32LittleEndian(packet.AsSpan(12), Size);
        var values = MemoryMarshal.Cast<byte, float>(packet.AsSpan(16));
        for (int i = 0; i < Size; i++)
        {
            var sample = ring[(position + i) % Size];
            values[Size / 2 + i] = sample;
            fft[i] = new Complex(sample * Window[i], 0);
        }
        Transform(fft);
        for (int i = 0; i < Size / 2; i++)
        {
            smoothed[i] = .72f * smoothed[i] + .28f * (float)(fft[i].Magnitude / Size);
            values[i] = Math.Max(-160, 20 * MathF.Log10(Math.Max(1e-8f, smoothed[i])));
        }
        return packet;
    }
    private static void Transform(Complex[] data)
    {
        for (int i = 1, j = 0; i < data.Length; i++)
        {
            int bit = data.Length >> 1;
            for (; (j & bit) != 0; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) (data[i], data[j]) = (data[j], data[i]);
        }
        for (int length = 2; length <= data.Length; length <<= 1)
        {
            int stride = data.Length / length;
            for (int offset = 0; offset < data.Length; offset += length)
            {
                for (int j = 0; j < length / 2; j++)
                {
                    var a = data[offset + j];
                    var b = data[offset + j + length / 2] * Twiddles[j * stride];
                    data[offset + j] = a + b;
                    data[offset + j + length / 2] = a - b;
                }
            }
        }
    }
}
