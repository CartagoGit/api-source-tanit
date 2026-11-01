using Microsoft.AspNetCore.Mvc;

namespace Sample.Controllers;

[ApiController]
[Route("api/v1/orders")]
public class OrdersController : ControllerBase
{
    [HttpGet]
    public IActionResult List() => Ok(new { orders = Array.Empty<object>() });

    [HttpPost]
    public IActionResult Create([FromBody] Order order) => Ok(order);

    [HttpGet("{id}")]
    public IActionResult Show(long id) => Ok(new { id });
}

public class Order
{
    public string CustomerName { get; set; } = "";
    public string CustomerEmail { get; set; } = "";
    public int Amount { get; set; }
}
