using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;

namespace GifCapture;

public class Recorder
{
    readonly object _lock = new();
    readonly Size _size;
    Point _location;
    readonly int _fps;
    readonly string _dir;
    readonly List<Frame> _frames = new();
    CancellationTokenSource? _cts;
    Task? _loop;

    public int Count => _frames.Count;

    public Recorder(Rectangle region, int fps)
    {
        _size = region.Size;
        _location = region.Location;
        _fps = fps;
        _dir = Path.Combine(Path.GetTempPath(), "GifCapture", DateTime.Now.ToString("yyyyMMdd_HHmmss"));
        Directory.CreateDirectory(_dir);
    }

    public void Start()
    {
        _cts = new CancellationTokenSource();
        var token = _cts.Token;
        _loop = Task.Run(() => Loop(token));
    }

    /// <summary>Moves the captured area; its size stays fixed so every frame has the same dimensions.</summary>
    public void MoveTo(Point location)
    {
        lock (_lock) _location = location;
    }

    public async Task<List<Frame>> StopAsync()
    {
        _cts?.Cancel();
        if (_loop != null) await _loop;
        return _frames;
    }

    void Loop(CancellationToken token)
    {
        var interval = 1000.0 / _fps;
        var clock = Stopwatch.StartNew();
        var index = 0;
        var last = 0.0;
        Frame? previous = null;

        while (!token.IsCancellationRequested)
        {
            var now = clock.Elapsed.TotalMilliseconds;
            Point location;
            lock (_lock) location = _location;
            using var bmp = new Bitmap(_size.Width, _size.Height, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(bmp))
                g.CopyFromScreen(location, Point.Empty, _size);

            var path = Path.Combine(_dir, $"{index++:D5}.bmp");
            bmp.Save(path, ImageFormat.Bmp);

            // A frame's delay is the time until the next one was taken.
            if (previous != null) previous.DelayMs = Math.Max(10, (int)Math.Round(now - last));
            previous = new Frame { Path = path, DelayMs = (int)interval };
            _frames.Add(previous);
            last = now;

            var wait = interval - (clock.Elapsed.TotalMilliseconds - now);
            if (wait > 1) token.WaitHandle.WaitOne((int)wait);
        }
    }
}
