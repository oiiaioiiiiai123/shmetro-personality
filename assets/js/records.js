(function () {
  'use strict';
  const KEY = 'shmetro.personality.lastResult.v1';
  const SCHEMA_VERSION = 1;
  const TEST_VERSION = '5.0';

  // Identify scoring inputs, not a user. Future artwork/story fields must not
  // invalidate a completed test when its questions and scoring are unchanged.
  function fingerprint(data) {
    const definition = {
      rankWeights: data.meta.rankWeights,
      secondaryWeight: data.meta.secondPreferenceWeight,
      questions: data.questions.map(({id, title, prompt, weight, choices}) => ({
        id, title, prompt, weight, choices: choices.map(({key, text}) => ({key, text}))
      })),
      profiles: data.roles.map(({id, primary, secondary}) => ({id, primary, secondary}))
    };
    let hash = 2166136261;
    for (const char of JSON.stringify(definition)) {
      hash ^= char.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return 'data-' + (hash >>> 0).toString(16);
  }

  function createStore(data, calculate) {
    const revision = fingerprint(data);
    const entry = result => ({lineId: result.role.id, lineName: result.role.line, score: result.score});

    function create(answers, completedAt = new Date().toISOString()) {
      const ranking = calculate(answers);
      return {
        schemaVersion: SCHEMA_VERSION,
        testVersion: TEST_VERSION,
        dataFingerprint: revision,
        completedAt,
        result: entry(ranking[0]),
        topThree: ranking.slice(0, 3).map(entry),
        // Each array is the original click order: first, second, third.
        answers: answers.map(answer => [...answer])
      };
    }

    function validate(value) {
      try {
        if (!value || value.schemaVersion !== SCHEMA_VERSION || value.testVersion !== TEST_VERSION || value.dataFingerprint !== revision) return null;
        if (typeof value.completedAt !== 'string' || new Date(value.completedAt).toISOString() !== value.completedAt) return null;
        if (!Array.isArray(value.answers) || value.answers.length !== data.questions.length) return null;
        if (!Array.isArray(value.topThree) || value.topThree.length !== 3) return null;
        const canonical = create(value.answers, value.completedAt);
        const same = (saved, actual) => saved && saved.lineId === actual.lineId && saved.lineName === actual.lineName && Number.isFinite(saved.score) && Math.abs(saved.score - actual.score) < 1e-9;
        if (!same(value.result, canonical.result) || !value.topThree.every((item, i) => same(item, canonical.topThree[i]))) return null;
        return canonical;
      } catch (_) {
        return null;
      }
    }

    function load() {
      try {
        const raw = window.localStorage.getItem(KEY);
        if (raw === null) return {record: null, status: 'empty'};
        const record = raw.length <= 32000 ? validate(JSON.parse(raw)) : null;
        return {record, status: record ? 'saved' : 'invalid'};
      } catch (error) {
        return {record: null, status: error instanceof SyntaxError ? 'invalid' : 'unavailable'};
      }
    }

    function save(record) {
      const canonical = validate(record);
      if (!canonical) throw new Error('不能保存未完成或不兼容的测试记录');
      try {
        // One atomic write. Never clear an earlier complete result first.
        window.localStorage.setItem(KEY, JSON.stringify(canonical));
        return {record: canonical, status: 'saved'};
      } catch (_) {
        return {record: canonical, status: 'unavailable'};
      }
    }

    return {create, validate, load, save};
  }

  window.MetroRecords = Object.freeze({KEY, SCHEMA_VERSION, TEST_VERSION, createStore});
}());
