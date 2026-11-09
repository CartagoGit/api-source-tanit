using AspNetComprehensive.Models;
using Microsoft.AspNetCore.Mvc;

namespace AspNetComprehensive.Controllers;

[ApiController]
[Route("api/users")]
public class UsersController : ControllerBase
{
    [HttpGet]
    public IActionResult List() => Ok(Array.Empty<User>());

    [HttpPost]
    public IActionResult Create([FromBody] User body) => Ok(body);

    [HttpGet("{id}")]
    public IActionResult Show(string id) => Ok(new User());

    [HttpPut("{id}")]
    public IActionResult Update(string id, [FromBody] User body) => Ok(body);

    [HttpDelete("{id}")]
    public IActionResult Delete(string id) => NoContent();
}