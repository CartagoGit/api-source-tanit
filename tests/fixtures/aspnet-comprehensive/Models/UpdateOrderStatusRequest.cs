using System.ComponentModel.DataAnnotations;

namespace AspNetComprehensive.Models;

public class UpdateOrderStatusRequest
{
    [Required]
    [RegularExpression("pending|shipped|delivered|cancelled")]
    public string Status { get; set; } = string.Empty;

    [StringLength(500)]
    public string? Note { get; set; }
}
