using AspNetComprehensive.Models;
using Microsoft.AspNetCore.Mvc;

namespace AspNetComprehensive.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    [HttpPost("login")]
    public IActionResult Login([FromBody] LoginRequest body) => Ok(new { token = "fake" });

    [HttpPost("logout")]
    public IActionResult Logout() => NoContent();
}