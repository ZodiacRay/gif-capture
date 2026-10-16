using System.IO;
using System.Text.Json;

namespace GifCapture;

/// <summary>What the recorder frame looked like last time, so the next recording starts the same way.</summary>
public class RecorderSettings
{
    /// <summary>Recording area size in screen pixels.</summary>
    public int Width { get; set; }
    public int Height { get; set; }

    /// <summary>Window position in WPF units.</summary>
    public double Left { get; set; }
    public double Top { get; set; }

    public int Fps { get; set; } = 15;
    public bool TimerOn { get; set; }
    public int TimerSeconds { get; set; } = 10;
    public bool Pinned { get; set; }

    static readonly string FilePath =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GifCapture", "recorder.json");

    /// <summary>The saved settings, or null on first run or if the file is unreadable.</summary>
    public static RecorderSettings? Load()
    {
        try
        {
            if (!File.Exists(FilePath)) return null;
            var s = JsonSerializer.Deserialize<RecorderSettings>(File.ReadAllText(FilePath));
            return s is { Width: > 0, Height: > 0 } ? s : null;
        }
        catch
        {
            return null; // a damaged file just means "start with defaults"
        }
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch { }
    }
}
