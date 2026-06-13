// @author: zhjj
package com.zhjj.islandsurvival.service;

import com.zhjj.islandsurvival.dto.AuthResponse;
import com.zhjj.islandsurvival.dto.LoginRequest;
import com.zhjj.islandsurvival.dto.RegisterRequest;
import com.zhjj.islandsurvival.entity.Account;
import com.zhjj.islandsurvival.exception.ApiException;
import com.zhjj.islandsurvival.repository.AccountRepository;
import com.zhjj.islandsurvival.security.JwtUtil;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {

    private final AccountRepository accounts;
    private final JwtUtil jwtUtil;
    private final PasswordEncoder passwordEncoder = new BCryptPasswordEncoder();

    public AuthService(AccountRepository accounts, JwtUtil jwtUtil) {
        this.accounts = accounts;
        this.jwtUtil = jwtUtil;
    }

    @Transactional
    public AuthResponse register(RegisterRequest req) {
        if (accounts.existsByUsername(req.username())) {
            throw ApiException.conflict("用户名已被占用");
        }
        Account acc = new Account();
        acc.setUsername(req.username());
        acc.setPasswordHash(passwordEncoder.encode(req.password()));
        accounts.save(acc);
        return new AuthResponse(jwtUtil.issue(acc.getId(), acc.getUsername()), acc.getId(), acc.getUsername());
    }

    @Transactional(readOnly = true)
    public AuthResponse login(LoginRequest req) {
        Account acc = accounts.findByUsername(req.username())
                .orElseThrow(() -> ApiException.unauthorized("用户名或密码错误"));
        if (!passwordEncoder.matches(req.password(), acc.getPasswordHash())) {
            throw ApiException.unauthorized("用户名或密码错误");
        }
        return new AuthResponse(jwtUtil.issue(acc.getId(), acc.getUsername()), acc.getId(), acc.getUsername());
    }
}
