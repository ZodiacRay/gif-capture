using System.Windows;

namespace GifCapture;

public partial class MainWindow : Window
{
    public MainWindow() => InitializeComponent();

    void Theme_Click(object sender, RoutedEventArgs e) => Theme.Toggle();

    async void Open_Click(object sender, RoutedEventArgs e)
    {
        var editor = await Importer.OpenGifAsync(this);
        if (editor == null) return;
        Hide();
        editor.Closed += (_, _) => Show();
        editor.Show();
    }

    void Record_Click(object sender, RoutedEventArgs e)
    {
        Hide();
        var frame = new RecorderFrame();
        frame.ShowDialog();

        if (frame.Frames.Count == 0) { Show(); return; }
        var editor = new EditorWindow(frame.Frames);
        editor.Closed += (_, _) => Show();
        editor.Show();
    }
}
