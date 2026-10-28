using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;

namespace StreamUI;

/// <summary>The EXE contains its web pages. A versioned cache lets the HTTP server serve them as ordinary files.</summary>
internal static class WebAssets
{
    public static string Resolve(string directory, string? explicitRoot)
    {
        if (explicitRoot is not null) return Path.GetFullPath(explicitRoot);
        using var resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("StreamUI.WebAssets.zip");
        if (resource is null) throw new IOException("程序中缺少网页资源，请重新运行 npm run host:package。");
        using var bytes = new MemoryStream(); resource.CopyTo(bytes);
        var data = bytes.ToArray();
        var version = Convert.ToHexString(SHA256.HashData(data))[..16];
        var root = Path.GetFullPath(Path.Combine(directory, "web", version));
        Directory.CreateDirectory(root);
        using var zip = new ZipArchive(new MemoryStream(data), ZipArchiveMode.Read);
        foreach (var entry in zip.Entries)
        {
            var destination = Path.GetFullPath(Path.Combine(root, entry.FullName));
            if (!destination.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("网页资源路径无效。");
            if (entry.FullName.EndsWith('/')) { Directory.CreateDirectory(destination); continue; }
            using var input = entry.Open(); using var content = new MemoryStream(); input.CopyTo(content);
            var expected = content.ToArray();
            if (File.Exists(destination) && SHA256.HashData(File.ReadAllBytes(destination)).SequenceEqual(SHA256.HashData(expected))) continue;
            Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
            var temporary = destination + "." + Guid.NewGuid().ToString("N") + ".tmp";
            File.WriteAllBytes(temporary, expected);
            File.Move(temporary, destination, true);
        }
        return root;
    }
}
