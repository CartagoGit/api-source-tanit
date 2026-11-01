// Minimal APIs — la forma por defecto desde .NET 6. Conviven en el mismo
// proyecto con los controladores clásicos de Controllers/.
using Microsoft.AspNetCore.Builder;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.MapGet("/health", () => Results.Ok(new { ok = true }));

var products = app.MapGroup("/api/products");

products.MapGet("/", () => Results.Ok(Array.Empty<object>()));
products.MapPost("/", (CreateProductRequest body) => Results.Created($"/api/products/1", body));
products.MapGet("/{id}", (int id) => Results.Ok(new { id }));
products.MapPut("/{id}", (int id, CreateProductRequest body) => Results.Ok(body));
products.MapDelete("/{id}", (int id) => Results.NoContent());

// Un endpoint comentado NO debe acabar en la colección.
// app.MapGet("/endpoint-comentado", () => Results.Ok());

app.Run();
