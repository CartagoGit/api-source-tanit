using System.ComponentModel.DataAnnotations;

public class CreateProductRequest
{
    [Required]
    [StringLength(120, MinimumLength = 2)]
    public string Name { get; set; } = string.Empty;

    [Required]
    [Range(0, 100000)]
    public decimal Price { get; set; }

    [EmailAddress]
    public string? ContactEmail { get; set; }
}
