// @author: zhjj
package com.zhjj.islandsurvival.config;

import com.zhjj.islandsurvival.security.JwtInterceptor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** CORS 放行前端 dev server；JWT 拦截器只挂在受保护的存档接口上。 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final JwtInterceptor jwtInterceptor;
    private final String[] allowedOrigins;

    public WebConfig(JwtInterceptor jwtInterceptor,
                     @Value("${app.cors.allowed-origins}") String allowedOrigins) {
        this.jwtInterceptor = jwtInterceptor;
        this.allowedOrigins = allowedOrigins.split("\\s*,\\s*");
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOrigins(allowedOrigins)
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .maxAge(3600);
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        // 仅存档接口需要登录；注册/登录接口保持公开
        registry.addInterceptor(jwtInterceptor)
                .addPathPatterns("/api/save", "/api/save/**");
    }
}
