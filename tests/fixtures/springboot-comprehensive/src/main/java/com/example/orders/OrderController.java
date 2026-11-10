package com.example.orders;

import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/orders")
public class OrderController {

    @GetMapping
    public List<Order> list() { return List.of(); }

    @PostMapping
    public Order create(@RequestBody @Valid Order body) { return body; }

    @GetMapping("/{id}")
    public Order show(@PathVariable String id) { return new Order(); }

    @PatchMapping("/{id}/status")
    public Order updateStatus(@PathVariable String id, @RequestBody @Valid Order body) { return body; }
}