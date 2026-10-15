using System.Windows;

namespace GifCapture;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        Theme.Load();
        base.OnStartup(e);
    }
}
