using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.DataProtection;

namespace DeployDock.Services;

/// <summary>
/// Шифрует строки подключения и ключи подписи перед записью в SQLite.
///
/// Формат v2: «dd2:» + base64(nonce | tag | шифртекст), AES-256-GCM.
/// Ключ лежит файлом deploydock.key рядом с базой, поэтому папку data можно переносить
/// на другой ПК или под другого пользователя. Обратная сторона: у кого есть папка data целиком,
/// тот прочитает и секреты — храни её там же, где хранил бы сами строки подключения.
///
/// Значения старого формата (Data Protection + DPAPI из версий 1.x) читаются через старые ключи
/// из %LOCALAPPDATA%\DeployDock\protection-keys — это работает на том же ПК под той же учёткой.
/// </summary>
public class SecretProtector
{
    const string Prefix = "dd2:";
    const int NonceSize = 12, TagSize = 16;

    readonly byte[] _key;
    readonly Lazy<IDataProtector?> _legacy;

    public SecretProtector()
    {
        _key = LoadOrCreateKey(AppPaths.KeyFile);
        _legacy = new Lazy<IDataProtector?>(CreateLegacy);
    }

    public string Protect(string plain)
    {
        var data = Encoding.UTF8.GetBytes(plain);
        var nonce = RandomNumberGenerator.GetBytes(NonceSize);
        var tag = new byte[TagSize];
        var cipher = new byte[data.Length];
        using (var aes = new AesGcm(_key, TagSize)) aes.Encrypt(nonce, data, cipher, tag);

        var blob = new byte[NonceSize + TagSize + cipher.Length];
        nonce.CopyTo(blob, 0);
        tag.CopyTo(blob, NonceSize);
        cipher.CopyTo(blob, NonceSize + TagSize);
        return Prefix + Convert.ToBase64String(blob);
    }

    public string Unprotect(string stored)
    {
        if (IsCurrent(stored))
        {
            var blob = Convert.FromBase64String(stored[Prefix.Length..]);
            if (blob.Length < NonceSize + TagSize) throw new CryptographicException("Повреждённое значение.");
            var nonce = blob.AsSpan(0, NonceSize);
            var tag = blob.AsSpan(NonceSize, TagSize);
            var cipher = blob.AsSpan(NonceSize + TagSize);
            var plain = new byte[cipher.Length];
            try
            {
                using var aes = new AesGcm(_key, TagSize);
                aes.Decrypt(nonce, cipher, tag, plain);
            }
            catch (CryptographicException)
            {
                throw new CryptographicException("Не подходит ключ: рядом с базой лежит не тот deploydock.key.");
            }
            return Encoding.UTF8.GetString(plain);
        }

        var legacy = _legacy.Value
            ?? throw new CryptographicException("Значение из старой версии, а её ключей на этом ПК нет.");
        return legacy.Unprotect(stored);
    }

    public static bool IsCurrent(string stored) => stored.StartsWith(Prefix, StringComparison.Ordinal);

    static byte[] LoadOrCreateKey(string path)
    {
        if (File.Exists(path))
        {
            var text = File.ReadAllText(path).Trim();
            var key = Convert.FromBase64String(text);
            if (key.Length != 32) throw new InvalidOperationException($"{path}: ключ должен быть 32 байта в base64.");
            return key;
        }

        var fresh = RandomNumberGenerator.GetBytes(32);
        // Пишем через временный файл, чтобы не оставить полупустой ключ при сбое
        var tmp = path + ".tmp";
        File.WriteAllText(tmp, Convert.ToBase64String(fresh));
        File.Move(tmp, path, overwrite: false);
        return fresh;
    }

    static IDataProtector? CreateLegacy()
    {
        var dir = new DirectoryInfo(AppPaths.LegacyProtectionKeys);
        if (!dir.Exists || !dir.EnumerateFiles("*.xml").Any()) return null;
        try
        {
            var provider = DataProtectionProvider.Create(dir, cfg =>
            {
                cfg.SetApplicationName("DeployDock");
                if (OperatingSystem.IsWindows()) cfg.ProtectKeysWithDpapi();
            });
            return provider.CreateProtector("DeployDock.Secrets.v1");
        }
        catch { return null; }
    }

    public static string Mask(string value)
    {
        if (string.IsNullOrEmpty(value)) return "";
        if (value.Length <= 8) return new string('•', value.Length);
        return value[..4] + new string('•', 8) + value[^4..];
    }

    public static string GenerateKey(int bytes, string format)
    {
        bytes = Math.Clamp(bytes, 16, 256);
        var raw = RandomNumberGenerator.GetBytes(bytes);
        return format.ToLowerInvariant() switch
        {
            "hex" => Convert.ToHexString(raw),
            "base64url" => Convert.ToBase64String(raw).TrimEnd('=').Replace('+', '-').Replace('/', '_'),
            _ => Convert.ToBase64String(raw),
        };
    }
}
