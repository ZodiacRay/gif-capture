using System.Collections.ObjectModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using Microsoft.Win32;

namespace GifCapture;

public partial class EditorWindow : Window
{
    readonly ObservableCollection<Frame> _frames;
    readonly DispatcherTimer _play = new();
    readonly PathToImageConverter _toImage = new();

    public EditorWindow(IEnumerable<Frame> frames)
    {
        InitializeComponent();
        Theme.Attach(this);
        _frames = new ObservableCollection<Frame>(frames);
        Strip.ItemsSource = _frames;
        _frames.CollectionChanged += (_, _) => { Renumber(); UpdateInfo(); };
        Renumber();
        _play.Tick += PlayTick;
        InitTools();
        Strip.SelectedIndex = 0;
        UpdateInfo();
    }

    async void OpenGif_Click(object sender, RoutedEventArgs e)
    {
        StopPlay();
        var editor = await Importer.OpenGifAsync(this);
        editor?.Show();
    }

    void Theme_Click(object sender, RoutedEventArgs e) => Theme.Toggle();

    void Renumber()
    {
        for (var i = 0; i < _frames.Count; i++) _frames[i].Number = i;
    }

    void UpdateInfo()
    {
        var ms = _frames.Sum(f => f.DelayMs);
        var fps = ms > 0 ? _frames.Count * 1000.0 / ms : 0;
        Info.Text = $"{_frames.Count} 프레임 · {ms / 1000.0:0.0}초 · 평균 {fps:0.#} fps";
    }

    void Strip_SelectionChanged(object sender, SelectionChangedEventArgs e) => RefreshPreview();

    void RefreshPreview()
    {
        if (Strip.SelectedItem is Frame f)
            Preview.Source = (System.Windows.Media.ImageSource?)_toImage.Convert(f.Path, typeof(object), null!, null!);
    }

    void Play_Click(object sender, RoutedEventArgs e)
    {
        if (_play.IsEnabled) { StopPlay(); return; }
        if (_frames.Count == 0) return;
        // Pressing play on the last frame (without looping) restarts from the beginning.
        if (Strip.SelectedIndex < 0 || (Strip.SelectedIndex == _frames.Count - 1 && PlayLoop.IsChecked != true)) Go(0);
        SetPlaying(true);
        _play.Interval = FrameInterval(Strip.SelectedIndex);
        _play.Start();
    }

    void PlayTick(object? s, EventArgs e)
    {
        var next = Strip.SelectedIndex + 1;
        if (next >= _frames.Count)
        {
            if (PlayLoop.IsChecked != true) { StopPlay(); return; }
            next = 0;
        }
        Go(next);
        _play.Interval = FrameInterval(next);
    }

    void StopPlay()
    {
        _play.Stop();
        SetPlaying(false);
    }

    void SetPlaying(bool playing)
    {
        PlayIcon.Text = playing ? "■" : "▶";
        PlayLabel.Text = playing ? "정지" : "재생";
    }

    TimeSpan FrameInterval(int index) =>
        TimeSpan.FromMilliseconds(Math.Max(10, _frames[index].DelayMs / GetSpeed()));

    void Go(int index)
    {
        if (_frames.Count == 0) return;
        index = Math.Clamp(index, 0, _frames.Count - 1);
        Strip.SelectedIndex = index;
        Strip.ScrollIntoView(_frames[index]);
    }

    void First_Click(object sender, RoutedEventArgs e) => Go(0);
    void Prev_Click(object sender, RoutedEventArgs e) => Go(Strip.SelectedIndex - 1);
    void Next_Click(object sender, RoutedEventArgs e) => Go(Strip.SelectedIndex + 1);
    void Last_Click(object sender, RoutedEventArgs e) => Go(_frames.Count - 1);

    double GetSpeed() => double.TryParse(Speed.Text, out var v) && v > 0 ? v : 1;

    void Delete_Click(object sender, RoutedEventArgs e)
    {
        if (Strip.SelectedItems.Count == 0) return;
        PushUndo();
        var idx = Strip.SelectedIndex;
        foreach (var f in Strip.SelectedItems.Cast<Frame>().ToList()) _frames.Remove(f);
        if (_frames.Count > 0) Strip.SelectedIndex = Math.Min(idx, _frames.Count - 1);
        else Preview.Source = null;
    }

    void TrimBefore_Click(object sender, RoutedEventArgs e)
    {
        if (Strip.SelectedIndex <= 0) return;
        PushUndo();
        for (var i = Strip.SelectedIndex - 1; i >= 0; i--) _frames.RemoveAt(i);
    }

    void TrimAfter_Click(object sender, RoutedEventArgs e)
    {
        if (Strip.SelectedIndex < 0 || Strip.SelectedIndex >= _frames.Count - 1) return;
        PushUndo();
        while (_frames.Count > Strip.SelectedIndex + 1) _frames.RemoveAt(_frames.Count - 1);
    }

    async void Export_Click(object sender, RoutedEventArgs e)
    {
        if (_frames.Count == 0) return;
        var dlg = new SaveFileDialog { Filter = "GIF|*.gif", FileName = "recording.gif" };
        if (dlg.ShowDialog() != true) return;

        StopPlay();
        IsEnabled = false;
        var frames = _frames.ToList();
        var speed = GetSpeed();
        var loop = LoopBox.IsChecked == true;
        var progress = new Progress<string>(s => Info.Text = s);
        var limit = LimitBox.IsChecked == true && double.TryParse(LimitMb.Text, out var mb) && mb > 0
            ? (long)(mb * 1024 * 1024) : 0;
        try
        {
            if (limit == 0)
            {
                await Task.Run(() => Exporter.ExportGif(frames, dlg.FileName, speed, loop, 1, progress));
                Info.Text = $"저장 완료: {dlg.FileName} ({new System.IO.FileInfo(dlg.FileName).Length / 1048576.0:0.00} MB)";
            }
            else
            {
                var r = await Task.Run(() => Exporter.ExportToSize(frames, dlg.FileName, speed, loop, limit, progress));
                var size = $"{r.Bytes / 1048576.0:0.00} MB";
                Info.Text = r.FitTarget
                    ? $"저장 완료: {dlg.FileName} ({size}, 크기 {r.Scale:P0})"
                    : $"목표 용량에 맞추지 못했습니다. 최소 크기({r.Scale:P0})로 저장: {size}";
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "내보내기 실패");
        }
        finally { IsEnabled = true; }
    }
}
