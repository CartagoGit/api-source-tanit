using System.ComponentModel.DataAnnotations;

namespace AspNetComprehensive.Models;

public class User
{
    [Required]
    [StringLength(100, MinimumLength = 1)]
    public string Name { get; set; } = "";

    [Required]
    [EmailAddress]
    public string Email { get; set; } = "";

    [Required]
    [Range(0, 120)]
    public int Age { get; set; }

    [Required]
    [RegularExpression("^(admin|user|guest)$")]
    public string Role { get; set; } = "user";
}