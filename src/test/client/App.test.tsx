// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../client/App.tsx';

describe('App', () => {
  it('画面を開いた場合、アプリ名「Waders」を見出しとして表示する', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Waders' })).toBeInTheDocument();
  });
});
