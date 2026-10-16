using System.Windows;

namespace GifCapture;

public partial class MainWindow : Window
{
    UpdateInfo? _update;

    public MainWindow()
    {
        InitializeComponent();
        Theme.Attach(this);

        VersionText.Text = $"v{Updater.CurrentText}";
        AutoCheck.IsChecked = Settings.CheckUpdates;
        Loaded += async (_, _) =>
        {
            if (Settings.CheckUpdates) await CheckForUpdate(manual: false);
        };
    }

    void Theme_Click(object sender, RoutedEventArgs e) => Theme.Toggle();

    // ---- updates ----

    void AutoCheck_Changed(object sender, RoutedEventArgs e) => Settings.CheckUpdates = AutoCheck.IsChecked == true;

    async void Check_Click(object sender, RoutedEventArgs e) => await CheckForUpdate(manual: true);

    async Task CheckForUpdate(bool manual)
    {
        CheckBtn.IsEnabled = false;
        var result = await Updater.CheckAsync();
        CheckBtn.IsEnabled = true;

        if (result.Update is { } update)
        {
            _update = update;
            UpdateText.Text = $"새 버전 {update.Version}이 있습니다. (현재 {Updater.CurrentText})";
            UpdateBar.Visibility = Visibility.Collapsed;
            UpdateBtn.IsEnabled = LaterBtn.IsEnabled = true;
            UpdateBanner.Visibility = Visibility.Visible;
        }
        else if (manual)
        {
            MessageBox.Show(
                result.Failed ? "새 버전을 확인하지 못했습니다. 인터넷 연결을 확인하고 다시 시도하세요." : $"최신 버전({Updater.CurrentText})을 사용 중입니다.",
                "업데이트 확인");
        }
    }

    void Later_Click(object sender, RoutedEventArgs e) => UpdateBanner.Visibility = Visibility.Collapsed;

    async void Update_Click(object sender, RoutedEventArgs e)
    {
        if (_update is not { } update) return;

        UpdateBtn.IsEnabled = LaterBtn.IsEnabled = false;
        UpdateBar.Value = 0;
        UpdateBar.Visibility = Visibility.Visible;
        UpdateText.Text = "새 버전을 내려받는 중...";
        try
        {
            var path = await Updater.DownloadAsync(update, new Progress<double>(p => UpdateBar.Value = p * 100));
            UpdateText.Text = "설치 프로그램을 실행합니다...";
            Updater.StartInstaller(path);
            Application.Current.Shutdown(); // let the installer replace the exe, then it restarts the app
        }
        catch (Exception ex)
        {
            UpdateBar.Visibility = Visibility.Collapsed;
            UpdateText.Text = $"업데이트에 실패했습니다: {ex.Message}";
            UpdateBtn.IsEnabled = LaterBtn.IsEnabled = true;
        }
    }

    // ---- main actions ----

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
