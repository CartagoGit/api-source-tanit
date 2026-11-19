using System.ComponentModel.DataAnnotations;

namespace AspNetComprehensive.Models;

public class Order
{
    [Required]
    public string CustomerName { get; set; } = "";

    [Required]
    [EmailAddress]
    public string CustomerEmail { get; set; } = "";

    [Required]
    [Range(1, int.MaxValue)]
    public int Amount { get; set; }

    [Required]
    [RegularExpression("^(EUR|USD|GBP)$")]
    public string Currency { get; set; } = "EUR";
}