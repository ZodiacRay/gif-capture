using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

namespace GifCapture;

/// <summary>
/// Minimal GIF89a writer. Each frame gets its own palette (median cut), and after the first frame only
/// the area that changed is stored: unchanged pixels become transparent over the previous frame.
/// </summary>
public sealed class GifWriter : IDisposable
{
    const int MaxPaletteColors = 255; // one slot is kept for the transparent index

    readonly Stream _out;
    readonly bool _loop;
    int _width, _height;
    byte[]? _previous; // BGRA pixels of the previous source frame
    bool _headerWritten;

    public GifWriter(Stream output, bool loop)
    {
        _out = output;
        _loop = loop;
    }

    public void AddFrame(Bitmap bitmap, int delayMs)
    {
        int w = bitmap.Width, h = bitmap.Height;
        var pixels = new byte[w * h * 4];
        var data = bitmap.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        try
        {
            for (var y = 0; y < h; y++)
                Marshal.Copy(IntPtr.Add(data.Scan0, y * data.Stride), pixels, y * w * 4, w * 4);
        }
        finally { bitmap.UnlockBits(data); }

        AddFrame(pixels, w, h, delayMs);
    }

    public void AddFrame(byte[] bgra, int w, int h, int delayMs)
    {
        if (!_headerWritten)
        {
            _width = w; _height = h;
            WriteHeader();
            _headerWritten = true;
        }
        else if (w != _width || h != _height)
        {
            throw new InvalidOperationException("All GIF frames must have the same size.");
        }

        var first = _previous == null;
        var cur = MemoryMarshal.Cast<byte, uint>(bgra);
        var prev = first ? default : MemoryMarshal.Cast<byte, uint>(_previous);

        // Bounding box of what changed since the previous frame.
        int x0 = 0, y0 = 0, x1 = w - 1, y1 = h - 1;
        var anyChange = true;
        byte[]? mask = null; // 1 where a pixel differs from the previous frame; null on the first frame (all drawn)
        if (!first)
        {
            mask = new byte[w * h];
            x0 = w; y0 = h; x1 = -1; y1 = -1;
            for (var y = 0; y < h; y++)
            {
                var row = y * w;
                for (var x = 0; x < w; x++)
                {
                    if (((cur[row + x] ^ prev[row + x]) & 0x00FFFFFF) == 0) continue;
                    mask[row + x] = 1;
                    if (x < x0) x0 = x;
                    if (x > x1) x1 = x;
                    if (y < y0) y0 = y;
                    y1 = y;
                }
            }
            anyChange = x1 >= 0;
            if (!anyChange) { x0 = y0 = x1 = y1 = 0; } // keep the delay with a single transparent pixel
        }

        int rw = x1 - x0 + 1, rh = y1 - y0 + 1;
        bool Changed(int x, int y) => mask == null || mask[y * w + x] != 0;

        // Histogram of the colors that actually need to be drawn (15-bit bins, true channel sums per bin).
        var count = new int[32768];
        var sumR = new int[32768];
        var sumG = new int[32768];
        var sumB = new int[32768];
        if (anyChange)
        {
            for (var y = y0; y <= y1; y++)
                for (var x = x0; x <= x1; x++)
                {
                    if (!Changed(x, y)) continue;
                    var i = (y * w + x) * 4;
                    int b = bgra[i], g = bgra[i + 1], r = bgra[i + 2];
                    var bin = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
                    count[bin]++; sumR[bin] += r; sumG[bin] += g; sumB[bin] += b;
                }
        }

        var (palette, lut) = Quantize(count, sumR, sumG, sumB);
        var colors = palette.Length / 3;
        var useTransparency = !first;
        var transparentIndex = colors;
        var tableBits = 1;
        while ((1 << tableBits) < colors + 1) tableBits++;
        var tableSize = 1 << tableBits;

        var indices = new byte[rw * rh];
        for (var y = 0; y < rh; y++)
            for (var x = 0; x < rw; x++)
            {
                int sx = x0 + x, sy = y0 + y;
                if (anyChange && Changed(sx, sy))
                {
                    var i = (sy * w + sx) * 4;
                    var bin = ((bgra[i + 2] >> 3) << 10) | ((bgra[i + 1] >> 3) << 5) | (bgra[i] >> 3);
                    indices[y * rw + x] = (byte)lut[bin];
                }
                else
                {
                    indices[y * rw + x] = (byte)(useTransparency ? transparentIndex : 0);
                }
            }

        // Graphic control extension: delay, transparency, "do not dispose" so later frames draw on top.
        var centis = Math.Max(2, (delayMs + 5) / 10); // viewers treat <2 as 10 (100 ms)
        _out.WriteByte(0x21); _out.WriteByte(0xF9); _out.WriteByte(0x04);
        _out.WriteByte((byte)((1 << 2) | (useTransparency ? 1 : 0)));
        WriteUInt16(centis);
        _out.WriteByte((byte)(useTransparency ? transparentIndex : 0));
        _out.WriteByte(0x00);

        // Image descriptor with a local color table.
        _out.WriteByte(0x2C);
        WriteUInt16(x0); WriteUInt16(y0); WriteUInt16(rw); WriteUInt16(rh);
        _out.WriteByte((byte)(0x80 | (tableBits - 1)));

        var table = new byte[tableSize * 3];
        Array.Copy(palette, table, palette.Length);
        _out.Write(table, 0, table.Length);

        var minCodeSize = Math.Max(2, tableBits);
        _out.WriteByte((byte)minCodeSize);
        new LzwEncoder(_out).Encode(indices, minCodeSize);

        _previous = bgra;
    }

    void WriteHeader()
    {
        foreach (var c in "GIF89a") _out.WriteByte((byte)c);
        WriteUInt16(_width); WriteUInt16(_height);
        _out.WriteByte(0x70); // no global color table; 8 bits of color resolution
        _out.WriteByte(0);    // background index
        _out.WriteByte(0);    // pixel aspect ratio

        if (_loop)
        {
            // NETSCAPE2.0 application extension: loop forever.
            _out.WriteByte(0x21); _out.WriteByte(0xFF); _out.WriteByte(0x0B);
            foreach (var c in "NETSCAPE2.0") _out.WriteByte((byte)c);
            _out.WriteByte(0x03); _out.WriteByte(0x01);
            WriteUInt16(0);
            _out.WriteByte(0x00);
        }
    }

    void WriteUInt16(int v)
    {
        _out.WriteByte((byte)(v & 0xFF));
        _out.WriteByte((byte)((v >> 8) & 0xFF));
    }

    public void Dispose()
    {
        if (_headerWritten) _out.WriteByte(0x3B); // trailer
        _out.Flush();
    }

    // ---- median-cut color quantization ----

    /// <summary>Reduces the histogram to at most 255 colors; returns the RGB palette and a bin -> index lookup.</summary>
    static (byte[] Palette, int[] Lut) Quantize(int[] count, int[] sumR, int[] sumG, int[] sumB)
    {
        var lut = new int[32768];
        var order = new List<int>();
        for (var i = 0; i < 32768; i++) if (count[i] > 0) order.Add(i);
        if (order.Count == 0) return (new byte[3], lut);

        var bins = order.ToArray();
        var boxes = new List<(int Lo, int Hi)> { (0, bins.Length) };

        static int Channel(int bin, int ch) => ch == 0 ? (bin >> 10) & 31 : ch == 1 ? (bin >> 5) & 31 : bin & 31;

        // Returns (population, widest channel, its range) for a box.
        (long Pop, int Channel, int Range) Measure((int Lo, int Hi) box)
        {
            Span<int> min = stackalloc int[3] { 31, 31, 31 };
            Span<int> max = stackalloc int[3] { 0, 0, 0 };
            long pop = 0;
            for (var i = box.Lo; i < box.Hi; i++)
            {
                pop += count[bins[i]];
                for (var c = 0; c < 3; c++)
                {
                    var v = Channel(bins[i], c);
                    if (v < min[c]) min[c] = v;
                    if (v > max[c]) max[c] = v;
                }
            }
            var best = 0;
            for (var c = 1; c < 3; c++) if (max[c] - min[c] > max[best] - min[best]) best = c;
            return (pop, best, max[best] - min[best]);
        }

        while (boxes.Count < MaxPaletteColors)
        {
            var pick = -1;
            double bestScore = -1;
            (long Pop, int Channel, int Range) pickInfo = default;
            for (var b = 0; b < boxes.Count; b++)
            {
                if (boxes[b].Hi - boxes[b].Lo < 2) continue;
                var info = Measure(boxes[b]);
                var score = (double)info.Pop * (info.Range + 1);
                if (score > bestScore) { bestScore = score; pick = b; pickInfo = info; }
            }
            if (pick < 0) break;

            var (lo, hi) = boxes[pick];
            var ch = pickInfo.Channel;
            Array.Sort(bins, lo, hi - lo, Comparer<int>.Create((a, b) => Channel(a, ch).CompareTo(Channel(b, ch))));

            long run = 0;
            var mid = lo;
            for (var i = lo; i < hi - 1; i++)
            {
                run += count[bins[i]];
                mid = i + 1;
                if (run * 2 >= pickInfo.Pop) break;
            }
            boxes[pick] = (lo, mid);
            boxes.Add((mid, hi));
        }

        var palette = new byte[boxes.Count * 3];
        for (var b = 0; b < boxes.Count; b++)
        {
            long n = 0, r = 0, g = 0, bl = 0;
            for (var i = boxes[b].Lo; i < boxes[b].Hi; i++)
            {
                var bin = bins[i];
                n += count[bin]; r += sumR[bin]; g += sumG[bin]; bl += sumB[bin];
                lut[bin] = b;
            }
            palette[b * 3] = (byte)((r + n / 2) / n);
            palette[b * 3 + 1] = (byte)((g + n / 2) / n);
            palette[b * 3 + 2] = (byte)((bl + n / 2) / n);
        }
        return (palette, lut);
    }

    // ---- LZW (GIF flavour: variable code width up to 12 bits, clear code on table overflow) ----

    sealed class LzwEncoder
    {
        const int MaxCodes = 4096;

        readonly Stream _out;
        readonly byte[] _block = new byte[255];
        int _blockLen;
        uint _bits;
        int _bitCount;
        int _codeSize, _clearCode, _eoiCode, _nextCode;

        public LzwEncoder(Stream output) => _out = output;

        public void Encode(byte[] indices, int minCodeSize)
        {
            _clearCode = 1 << minCodeSize;
            _eoiCode = _clearCode + 1;
            _nextCode = _eoiCode + 1;
            _codeSize = minCodeSize + 1;

            var table = new Dictionary<int, int>(8192);
            Emit(_clearCode);

            int prefix = indices[0];
            for (var i = 1; i < indices.Length; i++)
            {
                int k = indices[i];
                var key = (prefix << 8) | k;
                if (table.TryGetValue(key, out var code)) { prefix = code; continue; }

                Emit(prefix);
                if (_nextCode < MaxCodes)
                {
                    table[key] = _nextCode++;
                    // The decoder adds its entry one code later, so widen only after the code that fills the range.
                    if (_nextCode - 1 > (1 << _codeSize) - 1 && _codeSize < 12) _codeSize++;
                }
                else
                {
                    Emit(_clearCode);
                    table.Clear();
                    _nextCode = _eoiCode + 1;
                    _codeSize = minCodeSize + 1;
                }
                prefix = k;
            }

            Emit(prefix);
            Emit(_eoiCode);
            if (_bitCount > 0) PutByte((byte)_bits);
            FlushBlock();
            _out.WriteByte(0); // block terminator
        }

        void Emit(int code)
        {
            _bits |= (uint)code << _bitCount;
            _bitCount += _codeSize;
            while (_bitCount >= 8)
            {
                PutByte((byte)_bits);
                _bits >>= 8;
                _bitCount -= 8;
            }
        }

        void PutByte(byte b)
        {
            _block[_blockLen++] = b;
            if (_blockLen == 255) FlushBlock();
        }

        void FlushBlock()
        {
            if (_blockLen == 0) return;
            _out.WriteByte((byte)_blockLen);
            _out.Write(_block, 0, _blockLen);
            _blockLen = 0;
        }
    }
}
