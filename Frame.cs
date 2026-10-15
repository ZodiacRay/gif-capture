using System.ComponentModel;
using System.Globalization;
using System.Windows.Data;
using System.Windows.Media.Imaging;

namespace GifCapture;

public class Frame : INotifyPropertyChanged
{
    int _number;
    string _path = "";

    /// <summary>Image file of this frame; replaced (never edited in place) by crop/text so edits can be undone.</summary>
    public required string Path
    {
        get => _path;
        set { _path = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Path))); }
    }
    public int DelayMs { get; set; }

    /// <summary>Position in the editor's list (0-based); renumbered whenever frames are removed.</summary>
    public int Number
    {
        get => _number;
        set { _number = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Number))); }
    }

    public event PropertyChangedEventHandler? PropertyChanged;
}

public class PathToImageConverter : IValueConverter
{
    public object? Convert(object value, Type targetType, object parameter, CultureInfo culture)
    {
        if (value is not string path) return null;
        var img = new BitmapImage();
        img.BeginInit();
        img.CacheOption = BitmapCacheOption.OnLoad;
        if (parameter is string w) img.DecodePixelWidth = int.Parse(w);
        img.UriSource = new Uri(path);
        img.EndInit();
        img.Freeze();
        return img;
    }

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) => throw new NotSupportedException();
}
