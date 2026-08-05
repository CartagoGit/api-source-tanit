using Microsoft.AspNetCore.Mvc;

namespace AspNetMini.Controllers;

[ApiController]
[Route("api/users")]
public class UsersController : ControllerBase
{
    [HttpGet]
    public IActionResult List() => Ok(Array.Empty<object>());

    [HttpPost]
    public IActionResult Create([FromBody] object body) => Ok(body);

    [HttpGet("{id}")]
    public IActionResult Show(string id) => Ok(new { id });

    [HttpDelete("{id}")]
    public IActionResult Delete(string id) => NoContent();
}
