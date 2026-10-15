using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Windows;
using Microsoft.Win32;

namespace GifCapture;

public static class Importer
{
    const int PropertyTagFrameDelay = 0x5100;

    /// <summary>Asks for a GIF, loads it and returns an editor for it (null if cancelled or failed).</summary>
    public static async Task<EditorWindow?> OpenGifAsync(Window owner)
    {
        var dlg = new OpenFileDialog { Filter = "GIF 이미지|*.gif", Title = "편집할 GIF 선택" };
        if (dlg.ShowDialog(owner) != true) return null;

        owner.IsEnabled = false;
        try
        {
            var frames = await Task.Run(() => ReadFrames(dlg.FileName));
            if (frames.Count == 0)
            {
                MessageBox.Show("GIF에서 프레임을 읽지 못했습니다.", "불러오기 실패");
                return null;
            }
            var editor = new EditorWindow(frames) { Title = $"편집기 - {Path.GetFileName(dlg.FileName)}" };
            return editor;
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "불러오기 실패");
            return null;
        }
        finally
        {
            owner.IsEnabled = true;
        }
    }

    /// <summary>Splits a GIF into one BMP per frame, keeping each frame's own delay.</summary>
    public static List<Frame> ReadFrames(string path)
    {
        var dir = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "GifCapture", "import_" + DateTime.Now.ToString("yyyyMMdd_HHmmss_fff"));
        Directory.CreateDirectory(dir);

        // Read into memory first so the source file is not left locked by GDI+.
        using var stream = new MemoryStream(File.ReadAllBytes(path));
        using var gif = Image.FromStream(stream);

        var count = gif.GetFrameCount(FrameDimension.Time);
        var delays = ReadDelays(gif, count);
        var frames = new List<Frame>(count);
        for (var i = 0; i < count; i++)
        {
            gif.SelectActiveFrame(FrameDimension.Time, i); // GDI+ returns the fully composed frame
            var file = System.IO.Path.Combine(dir, $"{i:D5}.bmp");
            using (var bmp = new Bitmap(gif.Width, gif.Height, PixelFormat.Format32bppArgb))
            using (var g = Graphics.FromImage(bmp))
            {
                g.Clear(System.Drawing.Color.White); // transparent areas become white, like most viewers
                g.DrawImageUnscaled(gif, 0, 0);
                bmp.Save(file, ImageFormat.Bmp);
            }
            frames.Add(new Frame { Path = file, DelayMs = delays[i] });
        }
        return frames;
    }

    static int[] ReadDelays(Image gif, int count)
    {
        var result = Enumerable.Repeat(100, count).ToArray();
        if (!gif.PropertyIdList.Contains(PropertyTagFrameDelay)) return result;

        var data = gif.GetPropertyItem(PropertyTagFrameDelay)!.Value!;
        for (var i = 0; i < count && (i + 1) * 4 <= data.Length; i++)
        {
            var centis = BitConverter.ToInt32(data, i * 4);
            // Browsers treat 0 or 1 centisecond as 100 ms, so do the same.
            result[i] = centis <= 1 ? 100 : centis * 10;
        }
        return result;
    }
}
