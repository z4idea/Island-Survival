// @author: zhjj
package com.zhjj.islandsurvival.controller;

import com.zhjj.islandsurvival.dto.AuthResponse;
import com.zhjj.islandsurvival.dto.LoginRequest;
import com.zhjj.islandsurvival.dto.RegisterRequest;
import com.zhjj.islandsurvival.service.AuthService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

/** 账号：注册 / 登录（公开，无需 token）。 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/register")
    public AuthResponse register(@Valid @RequestBody RegisterRequest req) {
        return authService.register(req);
    }

    @PostMapping("/login")
    public AuthResponse login(@Valid @RequestBody LoginRequest req) {
        return authService.login(req);
    }
}
