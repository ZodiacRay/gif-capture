using System.IO;
using System.Windows;
using System.Windows.Media;
using Microsoft.Win32;

namespace GifCapture;

public static class Theme
{
    static readonly string SettingFile =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GifCapture", "theme.txt");

    public static bool Dark { get; private set; }

    /// <summary>Uses the saved choice, or the Windows app theme the first time.</summary>
    public static void Load()
    {
        try
        {
            Dark = File.Exists(SettingFile)
                ? File.ReadAllText(SettingFile).Trim() == "dark"
                : Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
                    "AppsUseLightTheme", 1) is 0;
        }
        catch { }
        Apply();
    }

    public static void Toggle()
    {
        Dark = !Dark;
        Apply();
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(SettingFile)!);
            File.WriteAllText(SettingFile, Dark ? "dark" : "light");
        }
        catch { }
    }

    static void Apply()
    {
        Set("WindowBg", Dark ? "#1E1E1E" : "#FFFFFF");
        Set("PanelBg", Dark ? "#2B2B2B" : "#FFFFFF");
        Set("Fg", Dark ? "#E8E8E8" : "#1E1E1E");
        Set("InputBg", Dark ? "#383838" : "#FFFFFF");
        Set("BorderBr", Dark ? "#555555" : "#BDBDBD");
        Set("BtnBg", Dark ? "#404040" : "#E6E6E6");
        Set("Accent", Dark ? "#E53935" : "#D32F2F");

        // The button offers the opposite of the current mode.
        var r = Application.Current.Resources;
        r["ThemeIcon"] = Dark ? "☀" : "🌙";
        r["ThemeName"] = Dark ? "라이트 모드" : "다크 모드";
        r["ThemeLabel"] = Dark ? "☀ 라이트 모드" : "🌙 다크 모드";
    }

    static void Set(string key, string hex)
    {
        var brush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));
        brush.Freeze();
        Application.Current.Resources[key] = brush;
    }
}
