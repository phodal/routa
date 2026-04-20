use super::*;

impl RuntimeState {
    pub fn cycle_focus_for_width(&mut self, width: u16) {
        let panes = focus_panes_for_width(width);
        let index = panes
            .iter()
            .position(|pane| *pane == self.focus)
            .unwrap_or(0);
        self.focus = panes[(index + 1) % panes.len()];
    }

    pub fn cycle_focus_backward_for_width(&mut self, width: u16) {
        let panes = focus_panes_for_width(width);
        let index = panes
            .iter()
            .position(|pane| *pane == self.focus)
            .unwrap_or(0);
        self.focus = panes[(index + panes.len() - 1) % panes.len()];
    }

    pub fn sync_focus_for_width(&mut self, width: u16) {
        let panes = focus_panes_for_width(width);
        if !panes.contains(&self.focus) {
            self.focus = panes[0];
        }
    }

    pub fn move_selection_up(&mut self) {
        match self.focus {
            FocusPane::Runs => {
                self.set_selected_run(self.selected_run.saturating_sub(1));
            }
            FocusPane::Sessions => {
                self.set_selected_prompt_session(self.selected_prompt_session.saturating_sub(1));
            }
            FocusPane::Files => {
                self.selected_file = self.selected_file.saturating_sub(1);
            }
            FocusPane::Detail => {
                self.set_detail_scroll(self.detail_scroll.saturating_sub(1));
            }
            FocusPane::Fitness => {
                self.fitness_scroll = self.fitness_scroll.saturating_sub(1);
            }
        }
    }

    pub fn move_selection_down(&mut self) {
        match self.focus {
            FocusPane::Runs => {
                let len = self.cached_session_items.len();
                if len > 0 {
                    self.set_selected_run((self.selected_run + 1).min(len - 1));
                }
            }
            FocusPane::Sessions => {
                let len = self.cached_prompt_session_items.len();
                if len > 0 {
                    self.set_selected_prompt_session(
                        (self.selected_prompt_session + 1).min(len - 1),
                    );
                }
            }
            FocusPane::Files => {
                let len = self.cached_file_item_keys.len();
                if len > 0 {
                    self.selected_file = (self.selected_file + 1).min(len - 1);
                }
            }
            FocusPane::Detail => {
                self.set_detail_scroll(self.detail_scroll.saturating_add(1));
            }
            FocusPane::Fitness => {
                self.fitness_scroll = self.fitness_scroll.saturating_add(1);
            }
        }
    }

    pub fn page_up(&mut self) {
        match self.focus {
            FocusPane::Runs => {
                self.set_selected_run(self.selected_run.saturating_sub(PAGE_STEP));
            }
            FocusPane::Sessions => {
                self.set_selected_prompt_session(
                    self.selected_prompt_session.saturating_sub(PAGE_STEP),
                );
            }
            FocusPane::Files => {
                self.selected_file = self.selected_file.saturating_sub(PAGE_STEP);
                self.restore_detail_scroll_for_selection();
            }
            FocusPane::Detail => {
                self.set_detail_scroll(self.detail_scroll.saturating_sub(DETAIL_PAGE_STEP));
            }
            FocusPane::Fitness => {
                self.fitness_scroll = self.fitness_scroll.saturating_sub(DETAIL_PAGE_STEP);
            }
        }
    }

    pub fn page_down(&mut self) {
        match self.focus {
            FocusPane::Runs => {
                let len = self.cached_session_items.len();
                if len > 0 {
                    self.set_selected_run((self.selected_run + PAGE_STEP).min(len - 1));
                }
            }
            FocusPane::Sessions => {
                let len = self.cached_prompt_session_items.len();
                if len > 0 {
                    self.set_selected_prompt_session(
                        (self.selected_prompt_session + PAGE_STEP).min(len - 1),
                    );
                }
            }
            FocusPane::Files => {
                let len = self.cached_file_item_keys.len();
                if len > 0 {
                    self.selected_file = (self.selected_file + PAGE_STEP).min(len - 1);
                    self.restore_detail_scroll_for_selection();
                }
            }
            FocusPane::Detail => {
                self.set_detail_scroll(self.detail_scroll.saturating_add(DETAIL_PAGE_STEP));
            }
            FocusPane::Fitness => {
                self.fitness_scroll = self.fitness_scroll.saturating_add(DETAIL_PAGE_STEP);
            }
        }
    }

    pub fn toggle_follow_mode(&mut self) {
        self.follow_mode = !self.follow_mode;
    }

    pub fn toggle_theme_mode(&mut self) {
        self.theme_mode = match self.theme_mode {
            ThemeMode::Dark => ThemeMode::Light,
            ThemeMode::Light => ThemeMode::Dark,
        };
    }

    pub fn set_event_log_filter(&mut self, filter: EventLogFilter) {
        self.event_log_filter = filter;
    }

    pub fn cancel_search(&mut self) {
        self.search_active = false;
    }

    pub fn clear_search(&mut self) {
        self.search_active = false;
        self.search_query.clear();
        self.clamp_selection();
    }

    pub fn push_search_char(&mut self, ch: char) {
        self.search_active = true;
        self.search_query.push(ch);
        self.clamp_selection();
    }

    pub fn pop_search_char(&mut self) {
        self.search_query.pop();
        self.clamp_selection();
    }

    pub fn toggle_detail_mode(&mut self) {
        self.detail_mode = match self.detail_mode {
            DetailMode::Diff => DetailMode::File,
            DetailMode::File => DetailMode::Diff,
        };
        self.restore_detail_scroll_for_selection();
    }

    pub fn select_prev_file(&mut self) {
        let len = self.cached_file_item_keys.len();
        if len == 0 {
            return;
        }
        self.selected_file = self.selected_file.saturating_sub(1);
        self.restore_detail_scroll_for_selection();
    }

    pub fn select_next_file(&mut self) {
        let len = self.cached_file_item_keys.len();
        if len == 0 {
            return;
        }
        self.selected_file = (self.selected_file + 1).min(len - 1);
        self.restore_detail_scroll_for_selection();
    }

    pub(super) fn clamp_selection(&mut self) {
        self.rebuild_views();
        let session_len = self.cached_session_items.len();
        if session_len == 0 {
            self.selected_run = 0;
            self.selected_session = 0;
        } else {
            self.selected_run = self.selected_run.min(session_len - 1);
            self.selected_session = self.selected_session.min(session_len - 1);
        }
        let prompt_len = self.cached_prompt_session_items.len();
        if prompt_len == 0 {
            self.selected_prompt_session = 0;
        } else {
            self.selected_prompt_session = self.selected_prompt_session.min(prompt_len - 1);
        }

        self.cached_file_item_keys = self.compute_file_item_keys();
        let file_len = self.cached_file_item_keys.len();
        if file_len == 0 {
            self.selected_file = 0;
        } else {
            self.selected_file = self.selected_file.min(file_len - 1);
        }
        self.restore_detail_scroll_for_selection();
    }

    fn set_selected_run(&mut self, index: usize) {
        self.selected_run = index;
        self.selected_session = index;
        self.cached_prompt_session_items = self.compute_prompt_session_items();
        self.selected_prompt_session = 0;
        self.cached_file_item_keys = self.compute_file_item_keys();
        let file_len = self.cached_file_item_keys.len();
        if file_len == 0 {
            self.selected_file = 0;
        } else {
            self.selected_file = self.selected_file.min(file_len - 1);
        }
        self.restore_detail_scroll_for_selection();
    }

    fn set_selected_prompt_session(&mut self, index: usize) {
        self.selected_prompt_session = index;
        self.cached_file_item_keys = self.compute_file_item_keys();
        let file_len = self.cached_file_item_keys.len();
        if file_len == 0 {
            self.selected_file = 0;
        } else {
            self.selected_file = self.selected_file.min(file_len - 1);
        }
        self.restore_detail_scroll_for_selection();
    }

    fn set_detail_scroll(&mut self, value: u16) {
        self.detail_scroll = value;
        if matches!(self.detail_mode, DetailMode::File | DetailMode::Diff) {
            if let Some(file) = self.selected_file() {
                self.detail_scroll_cache
                    .insert(file.rel_path.clone(), self.detail_scroll);
            }
        }
    }

    fn restore_detail_scroll_for_selection(&mut self) {
        if matches!(self.detail_mode, DetailMode::File | DetailMode::Diff) {
            if let Some(file) = self.selected_file() {
                self.detail_scroll = self
                    .detail_scroll_cache
                    .get(&file.rel_path)
                    .copied()
                    .unwrap_or(0);
                return;
            }
        }
        self.detail_scroll = 0;
    }
}

fn focus_panes_for_width(width: u16) -> &'static [FocusPane] {
    if width < 165 {
        &RESPONSIVE_FOCUS_COMPACT
    } else {
        &RESPONSIVE_FOCUS_FULL
    }
}
