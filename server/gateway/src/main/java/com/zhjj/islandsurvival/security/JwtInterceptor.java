// @author: zhjj
package com.zhjj.islandsurvival.security;

import com.zhjj.islandsurvival.exception.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * 保护需要登录的接口：校验 Authorization: Bearer &lt;token&gt;，
 * 通过后把 accountId 写入 request attribute 供控制器读取。
 */
@Component
public class JwtInterceptor implements HandlerInterceptor {

    public static final String ATTR_ACCOUNT_ID = "accountId";

    private final JwtUtil jwtUtil;

    public JwtInterceptor(JwtUtil jwtUtil) {
        this.jwtUtil = jwtUtil;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        // CORS 预检直接放行
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) return true;

        String auth = request.getHeader("Authorization");
        if (auth == null || !auth.startsWith("Bearer ")) {
            throw ApiException.unauthorized("缺少或非法的 Authorization 头");
        }
        try {
            Long accountId = jwtUtil.parseAccountId(auth.substring(7).trim());
            request.setAttribute(ATTR_ACCOUNT_ID, accountId);
            return true;
        } catch (Exception e) {
            throw ApiException.unauthorized("token 无效或已过期");
        }
    }
}
