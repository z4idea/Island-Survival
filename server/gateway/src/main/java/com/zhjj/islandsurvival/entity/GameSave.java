// @author: zhjj
package com.zhjj.islandsurvival.entity;

import jakarta.persistence.*;
import java.time.Instant;

/**
 * 云存档：一个账号一份（对应前端原来唯一的 localStorage key）。
 * 刻意把整份 SaveData 当 JSON 文本整体存储 —— 后端对存档内部结构保持无知，
 * 完全契合前端「纯附加可选字段、按 version 判废」的存档演进策略：
 * 前端加字段时后端不用改表。{@code version} 单独抽列，仅用于查询/迁移。
 */
@Entity
@Table(name = "game_save", uniqueConstraints = @UniqueConstraint(name = "uk_save_account", columnNames = "account_id"))
public class GameSave {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "account_id", nullable = false)
    private Long accountId;

    /** 存档结构版本（取自 SaveData.version，前端当前为 4）。 */
    @Column(nullable = false)
    private int version;

    /** 整份 SaveData 的原始 JSON 文本。 */
    @Lob
    @Column(name = "data", nullable = false, columnDefinition = "LONGTEXT")
    private String data;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public Long getAccountId() { return accountId; }
    public void setAccountId(Long accountId) { this.accountId = accountId; }

    public int getVersion() { return version; }
    public void setVersion(int version) { this.version = version; }

    public String getData() { return data; }
    public void setData(String data) { this.data = data; }

    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
}
