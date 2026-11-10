using Microsoft.AspNetCore.Mvc;

namespace Sample.Controllers;

[ApiController]
[Route("api/v1/users")]
public class UsersController : ControllerBase
{
    [HttpGet]
    public IActionResult List() => Ok(new { users = Array.Empty<object>() });

    [HttpPost]
    public IActionResult Create([FromBody] User user) => Ok(user);

    [HttpGet("{id}")]
    public IActionResult Show(long id) => Ok(new { id });

    [HttpPut("{id}")]
    public IActionResult Update(long id, [FromBody] User user) => Ok(user);

    [HttpDelete("{id}")]
    public IActionResult Delete(long id) => Ok(new { deleted = id });
}

public class User
{
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";
    public int Age { get; set; }
}
