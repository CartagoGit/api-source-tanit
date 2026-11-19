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

    // x00036 S3: HEAD (health-checks K8s/LB) y OPTIONS (preflight CORS)
    // deben llegar a la colección. Antes se descartaban en silencio
    // porque `HTTP_METHODS` no los contenía.
    [HttpHead]
    public IActionResult Ping() => Ok();

    [HttpOptions]
    public IActionResult Preflight() => Ok();
}
