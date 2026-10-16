using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using Microsoft.Win32;

namespace GifCapture;

public static class Theme
{
    static readonly string SettingFile =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GifCapture", "theme.txt");

    const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
    const uint SWP_FLAGS = 0x0001 | 0x0002 | 0x0004 | 0x0010 | 0x0020; // NOSIZE|NOMOVE|NOZORDER|NOACTIVATE|FRAMECHANGED

    [DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    [DllImport("user32.dll")]
    static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);

    public static bool Dark { get; private set; }

    static event Action? Changed;

    /// <summary>
    /// The native title bar belongs to Windows, not WPF, so it follows the system theme unless asked.
    /// Keeps a window's title bar in step with the app theme, now and after every toggle.
    /// </summary>
    public static void Attach(Window window)
    {
        void Apply()
        {
            var hwnd = new WindowInteropHelper(window).Handle;
            if (hwnd == IntPtr.Zero) return;
            var on = Dark ? 1 : 0;
            DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, ref on, sizeof(int));
            SetWindowPos(hwnd, IntPtr.Zero, 0, 0, 0, 0, SWP_FLAGS); // repaint the frame right away
        }

        window.SourceInitialized += (_, _) => Apply();
        Changed += Apply;
        window.Closed += (_, _) => Changed -= Apply;
    }

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
        Changed?.Invoke();
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
