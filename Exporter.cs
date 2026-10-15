using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;

namespace GifCapture;

public record ExportResult(long Bytes, double Scale, bool FitTarget);

public static class Exporter
{
    const double MinScale = 0.1;

    public static void ExportGif(IReadOnlyList<Frame> frames, string path, double speed, bool loop,
        double scale = 1, IProgress<string>? progress = null, string label = "내보내는 중")
    {
        using var fs = File.Create(path);
        using var gif = new GifWriter(fs, loop);
        for (var i = 0; i < frames.Count; i++)
        {
            using var src = Image.FromFile(frames[i].Path);
            var delay = Math.Max(10, (int)(frames[i].DelayMs / speed));
            using var bmp = scale >= 0.999 ? new Bitmap(src) : Resize(src, scale);
            gif.AddFrame(bmp, delay);
            progress?.Report($"{label}... {i + 1}/{frames.Count}");
        }
    }

    /// <summary>
    /// GIF size grows roughly with pixel count, so binary-search the largest scale that fits the target.
    /// The best fitting result is kept at <paramref name="path"/>.
    /// </summary>
    public static ExportResult ExportToSize(IReadOnlyList<Frame> frames, string path, double speed, bool loop,
        long targetBytes, IProgress<string>? progress = null)
    {
        var temp = path + ".tmp";
        try
        {
            ExportGif(frames, temp, speed, loop, 1, progress, "시도 1");
            var size = new FileInfo(temp).Length;
            if (size <= targetBytes)
            {
                File.Move(temp, path, true);
                return new ExportResult(size, 1, true);
            }

            double lo = MinScale, hi = 1, bestScale = 0;
            long bestSize = 0;
            // Start near the estimate (size ~ scale^2) so most runs converge in a few passes.
            var guess = Math.Clamp(Math.Sqrt((double)targetBytes / size) * 0.95, lo, hi);
            for (var attempt = 2; attempt <= 8; attempt++)
            {
                var scale = attempt == 2 ? guess : (lo + hi) / 2;
                ExportGif(frames, temp, speed, loop, scale, progress, $"시도 {attempt} · 배율 {scale:P0}");
                size = new FileInfo(temp).Length;
                if (size <= targetBytes)
                {
                    bestScale = scale; bestSize = size;
                    File.Copy(temp, path, true);
                    lo = scale;
                    if (targetBytes - size < targetBytes * 0.05) break; // within 5% of the target
                }
                else hi = scale;
            }

            if (bestScale > 0) return new ExportResult(bestSize, bestScale, true);

            // Even the smallest tried scale was too big: save the smallest we can.
            ExportGif(frames, path, speed, loop, MinScale, progress, "최소 배율로 저장");
            return new ExportResult(new FileInfo(path).Length, MinScale, false);
        }
        finally
        {
            if (File.Exists(temp)) File.Delete(temp);
        }
    }

    static Bitmap Resize(Image src, double scale)
    {
        var w = Math.Max(1, (int)(src.Width * scale));
        var h = Math.Max(1, (int)(src.Height * scale));
        var bmp = new Bitmap(w, h);
        using var g = Graphics.FromImage(bmp);
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.DrawImage(src, 0, 0, w, h);
        return bmp;
    }
}
