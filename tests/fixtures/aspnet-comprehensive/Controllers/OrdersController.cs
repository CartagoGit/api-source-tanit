using AspNetComprehensive.Models;
using Microsoft.AspNetCore.Mvc;

namespace AspNetComprehensive.Controllers;

[ApiController]
[Route("api/orders")]
public class OrdersController : ControllerBase
{
    [HttpGet]
    public IActionResult List() => Ok(Array.Empty<Order>());

    [HttpPost]
    public IActionResult Create([FromBody] Order body) => Ok(body);

    [HttpGet("{id}")]
    public IActionResult Show(string id) => Ok(new Order());

    [HttpPatch("{id}/status")]
    public IActionResult UpdateStatus(string id, [FromBody] UpdateOrderStatusRequest body) => Ok(body);
}