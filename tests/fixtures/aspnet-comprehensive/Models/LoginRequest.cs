using System.ComponentModel.DataAnnotations;

namespace AspNetComprehensive.Models;

public class LoginRequest
{
    [Required]
    [EmailAddress]
    public string Email { get; set; } = "";

    [Required]
    [StringLength(128, MinimumLength = 8)]
    public string Password { get; set; } = "";
}