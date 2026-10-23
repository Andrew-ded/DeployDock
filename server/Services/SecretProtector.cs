using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;

namespace DeployDock.Services;

/// <summary>
/// Шифрует строки подключения и ключи перед записью в SQLite.
/// Мастер-ключи Data Protection на Windows закрыты через DPAPI текущего пользователя,
/// так что базу без твоей учётки не расшифровать.
/// </summary>
public class SecretProtector(IDataProtectionProvider provider)
{
    readonly IDataProtector _p = provider.CreateProtector("DeployDock.Secrets.v1");

    public string Protect(string plain) => _p.Protect(plain);
    public string Unprotect(string cipher) => _p.Unprotect(cipher);

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
