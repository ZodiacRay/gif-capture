using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;

namespace GifCapture;

public partial class RecorderFrame : Window
{
    const uint WDA_EXCLUDEFROMCAPTURE = 0x11;
    const int HotkeyId = 1, WM_HOTKEY = 0x0312, VK_F7 = 0x76;
    const double SideDip = 12, ChromeHeightDip = 32 + 44;

    [DllImport("user32.dll")] static extern bool SetWindowDisplayAffinity(IntPtr h, uint a);
    [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr h, int id, uint mods, uint vk);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr h, int id);

    readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromMilliseconds(100) };
    readonly System.Diagnostics.Stopwatch _clock = new();
    IntPtr _hwnd;
    Recorder? _recorder;
    TimeSpan _limit; // zero = record until stopped by hand
    bool _stopping;

    public List<Frame> Frames { get; private set; } = new();

    public RecorderFrame()
    {
        InitializeComponent();
        SizeChanged += (_, _) => ShowSize();
        LocationChanged += (_, _) => _recorder?.MoveTo(Region().Location);
        _timer.Tick += (_, _) => OnTick();
    }

    void Window_SourceInitialized(object? sender, EventArgs e)
    {
        _hwnd = new WindowInteropHelper(this).Handle;
        // The frame must never appear in the captured pixels.
        SetWindowDisplayAffinity(_hwnd, WDA_EXCLUDEFROMCAPTURE);
        HwndSource.FromHwnd(_hwnd)?.AddHook(WndProc);
        RegisterHotKey(_hwnd, HotkeyId, 0, VK_F7);
        ShowSize();
    }

    IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg == WM_HOTKEY && wParam.ToInt32() == HotkeyId)
        {
            Rec_Click(this, new RoutedEventArgs());
            handled = true;
        }
        return IntPtr.Zero;
    }

    /// <summary>The transparent centre in screen pixels.</summary>
    System.Drawing.Rectangle Region()
    {
        var p = Center.PointToScreen(new Point(0, 0));
        var dpi = VisualTreeHelper.GetDpi(this);
        return new System.Drawing.Rectangle((int)p.X, (int)p.Y,
            (int)(Center.ActualWidth * dpi.DpiScaleX) & ~1, (int)(Center.ActualHeight * dpi.DpiScaleY) & ~1);
    }

    void ShowSize()
    {
        if (_hwnd == IntPtr.Zero) return;
        var r = Region();
        WBox.Text = r.Width.ToString();
        HBox.Text = r.Height.ToString();
    }

    void Size_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter) Size_Apply(sender, e);
    }

    void Size_Apply(object sender, RoutedEventArgs e)
    {
        if (_recorder != null || !int.TryParse(WBox.Text, out var w) || !int.TryParse(HBox.Text, out var h)) { ShowSize(); return; }
        var dpi = VisualTreeHelper.GetDpi(this);
        Width = Math.Max(MinWidth, w / dpi.DpiScaleX + SideDip);
        Height = Math.Max(MinHeight, h / dpi.DpiScaleY + ChromeHeightDip);
    }

    void Rec_Click(object sender, RoutedEventArgs e)
    {
        if (_stopping) return;

        if (_recorder == null) StartRecording();
        else _ = StopRecording();
    }

    void StartRecording()
    {
        var region = Region();
        if (region.Width < 16 || region.Height < 16) return;
        var fps = int.TryParse(Fps.Text, out var f) ? Math.Clamp(f, 1, 60) : 15;
        _limit = LimitBox.IsChecked == true && int.TryParse(LimitSec.Text, out var sec) && sec > 0
            ? TimeSpan.FromSeconds(Math.Min(sec, 3600)) : TimeSpan.Zero;

        _recorder = new Recorder(region, fps);
        // The frame can still be dragged while recording (unless pinned), but not resized:
        // every frame must keep one size.
        Fps.IsEnabled = WBox.IsEnabled = HBox.IsEnabled = LimitBox.IsEnabled = LimitSec.IsEnabled = false;
        ApplyPin();
        _clock.Restart();
        _recorder.Start();
        _timer.Start();
        OnTick();
    }

    async Task StopRecording()
    {
        if (_recorder == null || _stopping) return;
        _stopping = true;
        _timer.Stop();
        Frames = await _recorder.StopAsync();
        _recorder = null;
        Close();
    }

    void OnTick()
    {
        if (_limit > TimeSpan.Zero && _clock.Elapsed >= _limit)
        {
            _ = StopRecording(); // timer ran out
            return;
        }
        var elapsed = _clock.Elapsed;
        var text = elapsed.ToString("mm':'ss");
        RecBtn.Content = _limit > TimeSpan.Zero
            ? $"■ 정지 · {text} / {_limit.ToString("mm':'ss")}"
            : $"■ 정지 · {text}";
    }

    void Theme_Click(object sender, RoutedEventArgs e) => Theme.Toggle();

    void Pin_Changed(object sender, RoutedEventArgs e) => ApplyPin();

    /// <summary>Pinned: no dragging or resizing. Unpinned: drag freely, resize only when not recording.</summary>
    void ApplyPin()
    {
        var pinned = PinBtn.IsChecked == true;
        Chrome.CaptionHeight = pinned ? 0 : 32;
        Chrome.ResizeBorderThickness = new Thickness(pinned || _recorder != null ? 0 : 6);
    }

    void Close_Click(object sender, RoutedEventArgs e) => Close();

    void Window_Closed(object? sender, EventArgs e)
    {
        _timer.Stop();
        UnregisterHotKey(_hwnd, HotkeyId);
        // Closed mid-recording: stop capturing and discard.
        if (_recorder != null) _ = _recorder.StopAsync();
    }
}
