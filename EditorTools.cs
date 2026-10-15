using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace GifCapture;

/// <summary>Crop and text tools. Both rewrite frame images into new files so they can be undone.</summary>
public partial class EditorWindow
{
    enum Tool { None, Crop, Text }

    static readonly (string Name, System.Windows.Media.Color Color)[] Palette =
    {
        ("흰색", Colors.White), ("검정", Colors.Black), ("빨강", Colors.Red),
        ("노랑", Colors.Yellow), ("초록", Colors.LimeGreen), ("파랑", Colors.DeepSkyBlue),
    };

    readonly Stack<(Frame Frame, string Path)[]> _undo = new();
    Tool _tool;
    [Flags]
    enum Edge { None = 0, Left = 1, Top = 2, Right = 4, Bottom = 8, Move = 16 }

    const double HandleTolerance = 8, MinCropPx = 8;
    readonly List<System.Windows.Shapes.Rectangle> _handles = new();
    Rect _crop;       // crop frame in image pixels
    Rect _cropStart;  // crop frame when the current drag began
    System.Windows.Point _dragFrom;
    Edge _dragEdge;
    bool _dragging;
    System.Windows.Point? _textPos;
    System.Windows.Media.Color _textColor = Colors.White;
    int _opCounter;

    void InitTools()
    {
        foreach (var (name, color) in Palette)
        {
            var b = new Button
            {
                Width = 22, Height = 22, Margin = new Thickness(0, 0, 4, 0), ToolTip = name, Tag = color,
                Background = new SolidColorBrush(color), BorderThickness = new Thickness(1),
            };
            b.Click += (_, _) => { _textColor = color; MarkSwatch(); UpdateTextPreview(); };
            Swatches.Children.Add(b);
        }
        MarkSwatch();
        for (var i = 0; i < 8; i++)
        {
            var h = new System.Windows.Shapes.Rectangle
            {
                Width = 10, Height = 10, Fill = System.Windows.Media.Brushes.White, Stroke = (System.Windows.Media.Brush)FindResource("Teal"),
                StrokeThickness = 1.5, Visibility = Visibility.Collapsed, IsHitTestVisible = false,
            };
            _handles.Add(h);
            Overlay.Children.Add(h);
        }
        Overlay.SizeChanged += (_, _) => { RenderCrop(); UpdateTextPreview(); };
    }

    void MarkSwatch()
    {
        foreach (Button b in Swatches.Children)
        {
            var on = (System.Windows.Media.Color)b.Tag == _textColor;
            b.BorderThickness = new Thickness(on ? 3 : 1);
            b.BorderBrush = on ? (System.Windows.Media.Brush)FindResource("Teal") : (System.Windows.Media.Brush)FindResource("BorderBr");
        }
    }

    // ---- tool switching ----

    void CropBtn_Click(object sender, RoutedEventArgs e) => SetTool(_tool == Tool.Crop ? Tool.None : Tool.Crop);
    void TextBtn_Click(object sender, RoutedEventArgs e) => SetTool(_tool == Tool.Text ? Tool.None : Tool.Text);
    void ToolCancel_Click(object sender, RoutedEventArgs e) => SetTool(Tool.None);

    void SetTool(Tool tool)
    {
        _tool = tool;
        StopPlay();
        CropBtn.IsChecked = tool == Tool.Crop;
        TextBtn.IsChecked = tool == Tool.Text;
        ToolPanel.Visibility = tool == Tool.None ? Visibility.Collapsed : Visibility.Visible;
        CropOpts.Visibility = tool == Tool.Crop ? Visibility.Visible : Visibility.Collapsed;
        TextOpts.Visibility = tool == Tool.Text ? Visibility.Visible : Visibility.Collapsed;
        Overlay.IsHitTestVisible = tool != Tool.None;
        Overlay.Cursor = tool == Tool.None ? Cursors.Arrow : Cursors.Cross;
        _textPos = null;
        // The crop frame starts as the whole image; the user shrinks it from the edges.
        if (tool == Tool.Crop && TryImageRect(out _, out _, out var w, out var h)) _crop = new Rect(0, 0, w, h);
        RenderCrop();
        UpdateTextPreview();
    }

    // ---- preview <-> image pixel mapping ----

    /// <summary>The area of the overlay actually covered by the (letterboxed) preview image.</summary>
    bool TryImageRect(out Rect area, out double scale, out int pw, out int ph)
    {
        area = default; scale = 1; pw = ph = 0;
        if (Preview.Source is not BitmapSource bs || Overlay.ActualWidth <= 0) return false;
        pw = bs.PixelWidth; ph = bs.PixelHeight;
        scale = Math.Min(Overlay.ActualWidth / pw, Overlay.ActualHeight / ph);
        if (scale <= 0) return false;
        double w = pw * scale, h = ph * scale;
        area = new Rect((Overlay.ActualWidth - w) / 2, (Overlay.ActualHeight - h) / 2, w, h);
        return true;
    }

    void Overlay_Down(object sender, MouseButtonEventArgs e)
    {
        if (!TryImageRect(out var area, out _, out _, out _)) return;
        var p = e.GetPosition(Overlay);
        if (_tool == Tool.Crop)
        {
            _dragEdge = HitTest(p);
            if (_dragEdge == Edge.None) return;
            _dragFrom = p;
            _cropStart = _crop;
            _dragging = true;
            Overlay.CaptureMouse();
        }
        else if (_tool == Tool.Text && area.Contains(p))
        {
            _textPos = p;
            UpdateTextPreview();
        }
    }

    void Overlay_Move(object sender, MouseEventArgs e)
    {
        if (_tool != Tool.Crop) return;
        var p = e.GetPosition(Overlay);
        if (!_dragging)
        {
            Overlay.Cursor = CursorFor(HitTest(p));
            return;
        }
        if (!TryImageRect(out _, out var scale, out var pw, out var ph)) return;
        double dx = (p.X - _dragFrom.X) / scale, dy = (p.Y - _dragFrom.Y) / scale;
        var s = _cropStart;

        if (_dragEdge == Edge.Move)
        {
            _crop = new Rect(Math.Clamp(s.X + dx, 0, pw - s.Width), Math.Clamp(s.Y + dy, 0, ph - s.Height), s.Width, s.Height);
        }
        else
        {
            double l = s.Left, t = s.Top, r = s.Right, b = s.Bottom;
            if (_dragEdge.HasFlag(Edge.Left)) l = Math.Clamp(s.Left + dx, 0, r - MinCropPx);
            if (_dragEdge.HasFlag(Edge.Right)) r = Math.Clamp(s.Right + dx, l + MinCropPx, pw);
            if (_dragEdge.HasFlag(Edge.Top)) t = Math.Clamp(s.Top + dy, 0, b - MinCropPx);
            if (_dragEdge.HasFlag(Edge.Bottom)) b = Math.Clamp(s.Bottom + dy, t + MinCropPx, ph);
            _crop = new Rect(l, t, r - l, b - t);
        }
        RenderCrop();
    }

    void Overlay_Up(object sender, MouseButtonEventArgs e)
    {
        _dragging = false;
        Overlay.ReleaseMouseCapture();
    }

    /// <summary>The crop frame in overlay coordinates.</summary>
    Rect CropOnOverlay()
    {
        if (!TryImageRect(out var area, out var scale, out _, out _)) return Rect.Empty;
        return new Rect(area.X + _crop.X * scale, area.Y + _crop.Y * scale, _crop.Width * scale, _crop.Height * scale);
    }

    Edge HitTest(System.Windows.Point p)
    {
        var r = CropOnOverlay();
        if (r.IsEmpty) return Edge.None;
        const double t = HandleTolerance;
        bool inX = p.X >= r.Left - t && p.X <= r.Right + t, inY = p.Y >= r.Top - t && p.Y <= r.Bottom + t;
        var edge = Edge.None;
        if (inY && Math.Abs(p.X - r.Left) <= t) edge |= Edge.Left;
        if (inY && Math.Abs(p.X - r.Right) <= t) edge |= Edge.Right;
        if (inX && Math.Abs(p.Y - r.Top) <= t) edge |= Edge.Top;
        if (inX && Math.Abs(p.Y - r.Bottom) <= t) edge |= Edge.Bottom;
        if (edge == Edge.None && r.Contains(p)) edge = Edge.Move;
        return edge;
    }

    static Cursor CursorFor(Edge e) => e switch
    {
        Edge.Left or Edge.Right => Cursors.SizeWE,
        Edge.Top or Edge.Bottom => Cursors.SizeNS,
        Edge.Left | Edge.Top or Edge.Right | Edge.Bottom => Cursors.SizeNWSE,
        Edge.Right | Edge.Top or Edge.Left | Edge.Bottom => Cursors.SizeNESW,
        Edge.Move => Cursors.SizeAll,
        _ => Cursors.Arrow,
    };

    /// <summary>Draws the crop frame, the dimmed area outside it, and the eight resize handles.</summary>
    void RenderCrop()
    {
        var show = _tool == Tool.Crop && TryImageRect(out _, out _, out _, out _);
        var vis = show ? Visibility.Visible : Visibility.Collapsed;
        SelRect.Visibility = Dim.Visibility = vis;
        foreach (var h in _handles) h.Visibility = vis;
        if (!show) return;

        TryImageRect(out var area, out _, out _, out _);
        var r = CropOnOverlay();
        Canvas.SetLeft(SelRect, r.X);
        Canvas.SetTop(SelRect, r.Y);
        SelRect.Width = r.Width;
        SelRect.Height = r.Height;
        Dim.Data = new GeometryGroup
        {
            FillRule = FillRule.EvenOdd,
            Children = { new RectangleGeometry(area), new RectangleGeometry(r) },
        };

        double cx = r.X + r.Width / 2, cy = r.Y + r.Height / 2;
        var points = new (double X, double Y)[]
        {
            (r.Left, r.Top), (cx, r.Top), (r.Right, r.Top), (r.Right, cy),
            (r.Right, r.Bottom), (cx, r.Bottom), (r.Left, r.Bottom), (r.Left, cy),
        };
        for (var i = 0; i < 8; i++)
        {
            Canvas.SetLeft(_handles[i], points[i].X - 5);
            Canvas.SetTop(_handles[i], points[i].Y - 5);
        }
        CropInfo.Text = $"{(int)Math.Round(_crop.Width)} × {(int)Math.Round(_crop.Height)} px";
    }

    // ---- text preview ----

    int TextSizePx => int.TryParse(TextSize.Text, out var v) ? Math.Clamp(v, 6, 500) : 32;

    void TextOption_Changed(object sender, RoutedEventArgs e) => UpdateTextPreview();

    void UpdateTextPreview()
    {
        if (TextPreview == null) return;
        if (_tool != Tool.Text || _textPos is not { } pos || string.IsNullOrEmpty(LabelText.Text) ||
            !TryImageRect(out _, out var scale, out _, out _))
        {
            TextPreview.Visibility = Visibility.Collapsed;
            return;
        }
        TextPreview.Text = LabelText.Text;
        TextPreview.FontSize = TextSizePx * scale;
        TextPreview.Foreground = new SolidColorBrush(_textColor);
        Canvas.SetLeft(TextPreview, pos.X);
        Canvas.SetTop(TextPreview, pos.Y);
        TextPreview.Visibility = Visibility.Visible;
    }

    // ---- applying edits ----

    async void CropApply_Click(object sender, RoutedEventArgs e)
    {
        if (!TryImageRect(out _, out _, out var pw, out var ph)) return;
        var x = Math.Clamp((int)Math.Round(_crop.X), 0, pw - 1);
        var y = Math.Clamp((int)Math.Round(_crop.Y), 0, ph - 1);
        var w = Math.Clamp((int)Math.Round(_crop.Width), 1, pw - x);
        var h = Math.Clamp((int)Math.Round(_crop.Height), 1, ph - y);
        var rect = new System.Drawing.Rectangle(x, y, w, h);

        SetTool(Tool.None);
        if (w == pw && h == ph) return; // frame still covers the whole image: nothing to crop
        await ApplyToFrames(_frames.ToList(), src => src.Clone(rect, src.PixelFormat), "자르는 중");
    }

    async void TextApply_Click(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(LabelText.Text) || _textPos is not { } pos ||
            !TryImageRect(out var area, out var scale, out _, out _))
        {
            MessageBox.Show("글자를 입력하고 미리보기에서 위치를 클릭하세요.", "글자 추가");
            return;
        }
        var text = LabelText.Text;
        var size = TextSizePx;
        var c = System.Drawing.Color.FromArgb(_textColor.R, _textColor.G, _textColor.B);
        var x = (float)((pos.X - area.X) / scale);
        var y = (float)((pos.Y - area.Y) / scale);
        var targets = SelectedOnly.IsChecked == true ? Strip.SelectedItems.Cast<Frame>().ToList() : _frames.ToList();

        SetTool(Tool.None);
        await ApplyToFrames(targets, src => DrawText(src, text, x, y, size, c), "글자 넣는 중");
    }

    static Bitmap DrawText(Bitmap src, string text, float x, float y, int size, System.Drawing.Color color)
    {
        var bmp = new Bitmap(src.Width, src.Height, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
        using var g = Graphics.FromImage(bmp);
        g.DrawImageUnscaled(src, 0, 0);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
        using var font = new Font("Malgun Gothic", size, System.Drawing.FontStyle.Bold, GraphicsUnit.Pixel);

        // Thin contrasting outline keeps the text readable on any background.
        var light = color.GetBrightness() > 0.5f;
        using var outline = new SolidBrush(light ? System.Drawing.Color.Black : System.Drawing.Color.White);
        var o = Math.Max(1, size / 16);
        foreach (var (dx, dy) in new[] { (-o, -o), (o, -o), (-o, o), (o, o), (0, -o), (0, o), (-o, 0), (o, 0) })
            g.DrawString(text, font, outline, x + dx, y + dy);
        using var fill = new SolidBrush(color);
        g.DrawString(text, font, fill, x, y);
        return bmp;
    }

    /// <summary>Runs <paramref name="op"/> on each target frame in parallel, writing results to new files.</summary>
    async Task ApplyToFrames(List<Frame> targets, Func<Bitmap, Bitmap> op, string label)
    {
        if (targets.Count == 0) return;
        var before = targets.Select(f => (f, f.Path)).ToArray();
        var snapshot = Snapshot();
        var opId = ++_opCounter;
        var done = 0;
        IsEnabled = false;
        try
        {
            var newPaths = await Task.Run(() =>
            {
                var result = new string[before.Length];
                Parallel.For(0, before.Length, i =>
                {
                    var old = before[i].Path;
                    using var src = new Bitmap(old);
                    using var dst = op(src);
                    var path = System.IO.Path.Combine(System.IO.Path.GetDirectoryName(old)!,
                        $"{System.IO.Path.GetFileNameWithoutExtension(old)}_e{opId}.bmp");
                    dst.Save(path, ImageFormat.Bmp);
                    result[i] = path;
                    var n = Interlocked.Increment(ref done);
                    Dispatcher.BeginInvoke(() => Info.Text = $"{label}... {n}/{before.Length}");
                });
                return result;
            });

            for (var i = 0; i < before.Length; i++) before[i].f.Path = newPaths[i];
            _undo.Push(snapshot);
            UndoBtn.IsEnabled = true;
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "편집 실패");
        }
        finally
        {
            IsEnabled = true;
        }
        RefreshPreview();
        UpdateInfo();
    }

    /// <summary>Every frame and the image file it currently points to; restoring it undoes any edit.</summary>
    (Frame Frame, string Path)[] Snapshot() => _frames.Select(f => (f, f.Path)).ToArray();

    /// <summary>Call before any edit that changes the frame list or frame images.</summary>
    void PushUndo()
    {
        _undo.Push(Snapshot());
        UndoBtn.IsEnabled = true;
    }

    void Undo_Click(object sender, RoutedEventArgs e) => Undo();

    void Undo()
    {
        if (_undo.Count == 0) return;
        StopPlay();
        var index = Strip.SelectedIndex;
        _frames.Clear();
        foreach (var (frame, path) in _undo.Pop())
        {
            frame.Path = path;
            _frames.Add(frame);
        }
        UndoBtn.IsEnabled = _undo.Count > 0;
        Go(Math.Min(index, _frames.Count - 1));
        RefreshPreview();
        UpdateInfo();
    }

    void Window_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        // Inside a text box Ctrl+Z should undo typing, not frame edits.
        if (e.Key == Key.Z && Keyboard.Modifiers == ModifierKeys.Control && Keyboard.FocusedElement is not TextBox)
        {
            Undo();
            e.Handled = true;
        }
    }
}
