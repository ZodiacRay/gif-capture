using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;

namespace GifCapture;

public record UpdateInfo(Version Version, string DownloadUrl, long Size, string? Sha256);

/// <summary>Result of an update check: <see cref="Update"/> is null when up to date or when the check failed.</summary>
public record CheckResult(UpdateInfo? Update, bool Failed);

/// <summary>Looks for a newer GitHub release and downloads its installer.</summary>
public static class Updater
{
    const string Repo = "ZodiacRay/gif-capture";
    const string SetupAsset = "GifCapture-Setup.exe";
    static readonly string DownloadPrefix = $"https://github.com/{Repo}/releases/download/";

    static readonly HttpClient Http = CreateClient();

    public static Version Current => Normalize(Assembly.GetEntryAssembly()?.GetName().Version ?? new Version(0, 0, 0));

    public static string CurrentText => Current.ToString();

    /// <summary>Compare as major.minor.build only, so "0.2.0" equals "0.2.0.0".</summary>
    static Version Normalize(Version v) => new(v.Major, v.Minor, Math.Max(v.Build, 0));

    static HttpClient CreateClient()
    {
        var http = new HttpClient { Timeout = Timeout.InfiniteTimeSpan }; // timeouts are set per request
        http.DefaultRequestHeaders.UserAgent.ParseAdd($"GifCapture/{CurrentText}");
        http.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
        return http;
    }

    /// <param name="current">Overrides the running version (used by tests).</param>
    public static async Task<CheckResult> CheckAsync(Version? current = null, CancellationToken ct = default)
    {
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(8));

            using var response = await Http.GetAsync($"https://api.github.com/repos/{Repo}/releases/latest", timeout.Token);
            if (!response.IsSuccessStatusCode) return new CheckResult(null, true);

            using var doc = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(timeout.Token), cancellationToken: timeout.Token);
            var root = doc.RootElement;

            var tag = root.GetProperty("tag_name").GetString() ?? "";
            if (!Version.TryParse(tag.TrimStart('v', 'V'), out var latest)) return new CheckResult(null, true);
            latest = Normalize(latest);
            if (latest <= Normalize(current ?? Current)) return new CheckResult(null, false);

            foreach (var asset in root.GetProperty("assets").EnumerateArray())
            {
                if (asset.GetProperty("name").GetString() != SetupAsset) continue;

                var url = asset.GetProperty("browser_download_url").GetString() ?? "";
                var size = asset.GetProperty("size").GetInt64();
                string? sha = null;
                if (asset.TryGetProperty("digest", out var d) && d.GetString() is { } digest && digest.StartsWith("sha256:"))
                    sha = digest["sha256:".Length..];
                return new CheckResult(new UpdateInfo(latest, url, size, sha), false);
            }
            return new CheckResult(null, true); // newer release without an installer asset
        }
        catch
        {
            return new CheckResult(null, true); // offline, rate limited, malformed reply...
        }
    }

    /// <summary>Downloads the installer and verifies size and SHA-256 before returning its path.</summary>
    public static async Task<string> DownloadAsync(UpdateInfo update, IProgress<double>? progress = null, CancellationToken ct = default)
    {
        // Only fetch from this project's release downloads, never from an address the server hands us.
        if (!update.DownloadUrl.StartsWith(DownloadPrefix, StringComparison.Ordinal))
            throw new InvalidOperationException("신뢰할 수 없는 다운로드 주소입니다.");

        var dir = Path.Combine(Path.GetTempPath(), "GifCapture", "update");
        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, $"GifCapture-Setup-{update.Version}.exe");

        try
        {
            using var response = await Http.GetAsync(update.DownloadUrl, HttpCompletionOption.ResponseHeadersRead, ct);
            response.EnsureSuccessStatusCode();

            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            await using (var source = await response.Content.ReadAsStreamAsync(ct))
            await using (var target = File.Create(path))
            {
                var buffer = new byte[81920];
                long done = 0;
                int read;
                while ((read = await source.ReadAsync(buffer, ct)) > 0)
                {
                    await target.WriteAsync(buffer.AsMemory(0, read), ct);
                    hash.AppendData(buffer, 0, read);
                    done += read;
                    if (update.Size > 0) progress?.Report((double)done / update.Size);
                }
            }

            if (new FileInfo(path).Length != update.Size)
                throw new InvalidDataException("받은 파일의 크기가 맞지 않습니다.");
            if (update.Sha256 != null &&
                !Convert.ToHexString(hash.GetHashAndReset()).Equals(update.Sha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("받은 파일의 무결성 검사에 실패했습니다.");

            return path;
        }
        catch
        {
            try { File.Delete(path); } catch { }
            throw;
        }
    }

    /// <summary>Runs the installer quietly; the caller should exit so the app files can be replaced.</summary>
    public static void StartInstaller(string path) =>
        Process.Start(new ProcessStartInfo(path, "/SILENT /NORESTART /update=1") { UseShellExecute = true });
}

/// <summary>Small persisted choices that are not part of the theme.</summary>
public static class Settings
{
    static readonly string UpdateFile =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GifCapture", "update-check.txt");

    /// <summary>Whether to look for a new version when the app starts (on by default).</summary>
    public static bool CheckUpdates
    {
        get
        {
            try { return !File.Exists(UpdateFile) || File.ReadAllText(UpdateFile).Trim() != "off"; }
            catch { return true; }
        }
        set
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(UpdateFile)!);
                File.WriteAllText(UpdateFile, value ? "on" : "off");
            }
            catch { }
        }
    }
}
