mise activate fish | source

# Exports every KEY=VALUE from one or more env files into the current shell.
function srcenv
	for env_filename in $argv
		test -f $env_filename; or continue
		cat $env_filename | grep -vE '^(#|\s*$)' | while read line
			set item (string split -m 1 '=' $line)
			set --export --global $item[1] $item[2]
		end
	end
end

# Splits the caller's tmux window — which must hold only the calling pane — into
# `left | right` across the top and `center` below it: full width, or
# `center | fourth` when --fourth is given. The calling pane becomes `left`.
# Focus ends on the right pane.
#
# Panes are addressed by id (%N), which unlike the index survives later splits,
# so no step depends on which pane happens to be active.
function tmux_dev_panes
	# Flags are declared `=` (required value) rather than `=?` (optional), which
	# fish only accepts as `--flag=value`; the space-separated form used by
	# callers below needs `=`. --max-args=0 turns a stray positional into an error.
	argparse --max-args=0 'left=' 'right=' 'center=' 'fourth=' 'preamble=' -- $argv
	or return

	# TMUX_PANE is the pane this process lives in, even if focus has moved.
	if not set -q TMUX_PANE
		echo ">> aborted: not inside tmux. Open an empty tmux window and run it there." >&2
		return 1
	end
	set -l left $TMUX_PANE

	# A second run in the same window would stack another set of panes.
	set -l pane_count (tmux display-message -p -t $left '#{window_panes}')
	if test "$pane_count" != 1
		echo ">> aborted: this window already has $pane_count panes. Run from an empty tmux window." >&2
		return 1
	end

	# -d keeps focus put; -P -F prints the new pane's id.
	set -l center (tmux split-window -d -v -t $left -P -F '#{pane_id}'); or return
	set -l right (tmux split-window -d -h -t $left -P -F '#{pane_id}'); or return

	tmux send-keys -t $center "$_flag_preamble; $_flag_center" C-m
	tmux send-keys -t $right "$_flag_preamble; $_flag_right" C-m

	if set -q _flag_fourth; and test -n "$_flag_fourth"
		set -l fourth (tmux split-window -d -h -t $center -P -F '#{pane_id}'); or return
		tmux send-keys -t $fourth "$_flag_preamble; $_flag_fourth" C-m
	end

	tmux select-pane -t $right

	# The left pane is the one running this script, so these keys sit in its
	# input queue until `pnpm start` exits, then its shell runs them like any
	# typed command — same as the other panes, up-arrow re-runs just this step.
	# Must stay last: anything after it that reads stdin would eat them.
	tmux send-keys -t $left "$_flag_preamble; $_flag_left" C-m
end
