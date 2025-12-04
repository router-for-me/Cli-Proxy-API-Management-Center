/**
 * 模型工具函数
 * 提供模型列表的规范化与去重能力
 */
export function normalizeModelList(payload, { dedupe = false } = {}) {
    const toModel = (entry) => {
        if (typeof entry === 'string') {
            return { name: entry };
        }
        if (!entry || typeof entry !== 'object') {
            return null;
        }
        const name = entry.id || entry.name || entry.model || entry.value;
        if (!name) return null;

        const alias = entry.alias || entry.display_name || entry.displayName;
        const description = entry.description || entry.note || entry.comment;
        const model = { name: String(name) };
        if (alias && alias !== name) {
            model.alias = String(alias);
        }
        if (description) {
            model.description = String(description);
        }
        return model;
    };

    let models = [];

    if (Array.isArray(payload)) {
        models = payload.map(toModel).filter(Boolean);
    } else if (payload && typeof payload === 'object') {
        if (Array.isArray(payload.data)) {
            models = payload.data.map(toModel).filter(Boolean);
        } else if (Array.isArray(payload.models)) {
            models = payload.models.map(toModel).filter(Boolean);
        }
    }

    if (!dedupe) {
        return models;
    }

    const seen = new Set();
    return models.filter(model => {
        const key = (model?.name || '').toLowerCase();
        if (!key || seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

const MODEL_CATEGORIES = [
    { id: 'gpt', label: 'GPT', patterns: [/gpt/i, /\bo\d\b/i, /\bo\d+\.?/i, /\bchatgpt/i] },
    { id: 'claude', label: 'Claude', patterns: [/claude/i] },
    { id: 'gemini', label: 'Gemini', patterns: [/gemini/i, /\bgai\b/i] },
    { id: 'kimi', label: 'Kimi', patterns: [/kimi/i] },
    { id: 'qwen', label: 'Qwen', patterns: [/qwen/i] },
    { id: 'glm', label: 'GLM', patterns: [/glm/i, /chatglm/i] },
    { id: 'grok', label: 'Grok', patterns: [/grok/i] },
    { id: 'deepseek', label: 'DeepSeek', patterns: [/deepseek/i] }
];

function matchCategory(text) {
    for (const category of MODEL_CATEGORIES) {
        if (category.patterns.some(pattern => pattern.test(text))) {
            return category.id;
        }
    }
    return null;
}

export function classifyModels(models = [], { otherLabel = 'Other' } = {}) {
    const groups = MODEL_CATEGORIES.map(category => ({
        id: category.id,
        label: category.label,
        items: []
    }));

    const otherGroup = { id: 'other', label: otherLabel, items: [] };

    models.forEach(model => {
        const name = (model?.name || '').toString();
        const alias = (model?.alias || '').toString();
        const haystack = `${name} ${alias}`.toLowerCase();
        const matchedId = matchCategory(haystack);
        const target = matchedId ? groups.find(group => group.id === matchedId) : null;

        if (target) {
            target.items.push(model);
        } else {
            otherGroup.items.push(model);
        }
    });

    const populatedGroups = groups.filter(group => group.items.length > 0);
    if (otherGroup.items.length) {
        populatedGroups.push(otherGroup);
    }

    return populatedGroups;
}
