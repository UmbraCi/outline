import { renderHook } from "@testing-library/react";
import { getCookie, removeCookie } from "tiny-cookie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPostLoginPath, usePostLoginPath } from "./useLastVisitedPath";

const key = "postLoginRedirectPath";

beforeEach(() => {
  sessionStorage.clear();
  removeCookie(key);
});

afterEach(() => {
  vi.restoreAllMocks();
  removeCookie(key);
});

describe("usePostLoginPath", () => {
  it("does not reuse a path saved by another tab", () => {
    setPostLoginPath("/doc/other-tab");
    expect(getCookie(key)).toBe("/doc/other-tab");
    sessionStorage.removeItem(key);

    const { result } = renderHook(() => usePostLoginPath());

    expect(result.current[0]()).toBeUndefined();
  });

  it("falls back to the cookie when session storage is unavailable", () => {
    setPostLoginPath("/doc/fallback");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage is unavailable");
    });

    const { result } = renderHook(() => usePostLoginPath());

    expect(result.current[0]()).toBe("/doc/fallback");
  });
});
