// @author: zhjj
package com.zhjj.islandsurvival.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zhjj.islandsurvival.entity.GameSave;
import com.zhjj.islandsurvival.exception.ApiException;
import com.zhjj.islandsurvival.repository.GameSaveRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Optional;

/**
 * 云存档读写。后端对 SaveData 内部结构保持无知：整份 JSON 原样存取，
 * 只从中抽出 version 落列。一个账号一份存档（upsert）。
 */
@Service
public class SaveService {

    private final GameSaveRepository saves;
    private final ObjectMapper objectMapper;

    public SaveService(GameSaveRepository saves, ObjectMapper objectMapper) {
        this.saves = saves;
        this.objectMapper = objectMapper;
    }

    /** 返回账号当前存档的原始 JSON 文本；无存档返回空。 */
    @Transactional(readOnly = true)
    public Optional<String> load(Long accountId) {
        return saves.findByAccountId(accountId).map(GameSave::getData);
    }

    /** upsert：覆盖该账号的存档。 */
    @Transactional
    public void save(Long accountId, String rawJson) {
        int version = extractVersion(rawJson);
        GameSave save = saves.findByAccountId(accountId).orElseGet(GameSave::new);
        save.setAccountId(accountId);
        save.setVersion(version);
        save.setData(rawJson);
        save.setUpdatedAt(Instant.now());
        saves.save(save);
    }

    @Transactional
    public void delete(Long accountId) {
        saves.deleteByAccountId(accountId);
    }

    private int extractVersion(String rawJson) {
        try {
            JsonNode root = objectMapper.readTree(rawJson);
            JsonNode v = root.get("version");
            if (v == null || !v.isInt()) {
                throw ApiException.badRequest("存档缺少合法的 version 字段");
            }
            return v.intValue();
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            throw ApiException.badRequest("存档不是合法 JSON");
        }
    }
}
